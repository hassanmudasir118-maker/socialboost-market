// Real Stripe adapter, implementing the exact interface mockProvider.js
// implements (see paymentProvider/index.js). Uses Stripe's plain REST API
// via fetch + HTTP Basic Auth (secret key as username, blank password)
// rather than the `stripe` npm package — this avoids adding a dependency
// that couldn't be installed in the sandbox this was written in, and
// Stripe's REST API is stable and fully documented enough to call directly.
// If you'd rather use the official SDK, swap the fetch calls below for
// `stripe.paymentIntents.create()` etc. — the exported interface doesn't
// need to change either way.
//
// NOT executed against the real Stripe API in this environment (no network
// access, no real Stripe key) — implemented and reviewed against Stripe's
// current published API docs and webhook signing scheme (both checked live
// while writing this), not verified end-to-end. Stripe's test mode
// (`sk_test_...` keys) is exactly what you'd use to do that verification —
// nothing here needs "live mode" to test for real.

const API_BASE = "https://api.stripe.com/v1";

function secretKey() {
  const key = process.env.PAYMENT_SECRET_KEY;
  if (!key) throw new Error("PAYMENT_SECRET_KEY is not set");
  return key;
}

function authHeader() {
  return { Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString("base64")}` };
}

async function stripeRequest(method, path, formParams = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : new URLSearchParams(formParams),
  });
  const data = await res.json();
  if (!res.ok) {
    // Stripe error responses are { error: { message, type, code, ... } } —
    // surface the message but never log/return the secret key itself.
    throw new Error(data.error?.message || `Stripe API error (${res.status})`);
  }
  return data;
}

/**
 * Stripe amounts are already integer minor units (cents for USD) — same
 * convention this codebase uses everywhere, so amountCents passes through
 * unchanged. Some currencies have different minor-unit conventions (e.g.
 * JPY has no minor unit); this codebase only uses USD today (see
 * paymentGatewayService's CURRENCY constant), so that conversion isn't
 * handled here — add it if a second currency is ever supported.
 */
async function createPaymentIntent({ amountCents, currency, campaignId, userId, metadata }) {
  const intent = await stripeRequest("POST", "/payment_intents", {
    amount: String(amountCents),
    currency,
    "automatic_payment_methods[enabled]": "true",
    "metadata[campaignId]": campaignId,
    "metadata[advertiserUserId]": userId,
    ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)])),
  });
  return {
    providerPaymentId: intent.id,
    clientSecret: intent.client_secret, // the ONLY thing that may ever reach the frontend — see routes/payments.js, which does exactly that and nothing else
    amountCents: intent.amount,
    currency: intent.currency,
    status: intent.status,
  };
}

/**
 * Verifies Stripe's Stripe-Signature header per Stripe's documented scheme:
 * header is "t=<timestamp>,v1=<hex_hmac>[,v0=...]"; the signed payload is
 * "<timestamp>.<rawBody>", HMAC-SHA256 with the webhook signing secret.
 * Deliberately does NOT enforce a timestamp-recency window here (Stripe's
 * official library rejects signatures older than 5 minutes by default, to
 * block replay of a captured request) — add that check before going live if
 * replay risk matters for your threat model; the constant-time comparison
 * below is the part that must never be skipped.
 */
function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  const crypto = require("crypto");
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
  } catch (_) {
    return false; // length mismatch, malformed hex, etc. — never throw on attacker-controlled input
  }
}

/** Used only by the test-mode webhook simulator (never called when a real Stripe key is configured — see paymentGatewayService.TEST_MODE). */
function buildTestWebhookEvent() {
  throw new Error("buildTestWebhookEvent is a test-mode-only concept — use Stripe CLI's `stripe trigger` or the Dashboard's webhook tester against a real Stripe test-mode key instead.");
}

async function createRefund({ providerPaymentId, amountCents }) {
  const refund = await stripeRequest("POST", "/refunds", {
    payment_intent: providerPaymentId,
    amount: String(amountCents),
  });
  return { providerRefundId: refund.id, amountCents: refund.amount, status: refund.status === "succeeded" ? "SUCCEEDED" : refund.status.toUpperCase() };
}

/**
 * Real creator payouts need Stripe Connect: a Transfer moves money from the
 * PLATFORM's Stripe balance into a creator's own CONNECTED account, and
 * Stripe then pays that connected account's own bank on its own schedule
 * (or the creator triggers a Payout themselves, depending on the Connect
 * account type chosen — Express vs Custom). Stripe's Payouts API
 * (`/v1/payouts`) only ever sends money to YOUR OWN bank account — it
 * cannot target a third party, so it is not usable for this at all.
 *
 * `destination` here is expected to be the creator's user id (matching the
 * mock provider's interface and withdrawalService.js's call site) — this
 * adapter looks up their `wallets.stripe_connected_account_id` and fails
 * clearly if they haven't completed Connect onboarding, rather than
 * silently sending money nowhere or crashing on a missing field. Wiring up
 * that onboarding flow (create the connected account + an Account Link, a
 * "Set up payouts" button, and an `account.updated` webhook so we know when
 * it's actually ready) is real, separate work — see
 * migrations/0003_stripe_connect.sql and PRODUCTION_READINESS.md.
 */
async function createPayout({ amountCents, currency, destination }) {
  const { get } = require("../../db");
  const wallet = await get("SELECT stripe_connected_account_id, stripe_payouts_enabled FROM wallets WHERE user_id = ?", [destination]);
  if (!wallet?.stripe_connected_account_id || !wallet.stripe_payouts_enabled) {
    const err = new Error("This creator hasn't finished setting up payouts yet (Stripe Connect onboarding incomplete). Ask them to complete onboarding before retrying this withdrawal.");
    err.status = 409;
    throw err;
  }
  const transfer = await stripeRequest("POST", "/transfers", {
    amount: String(amountCents),
    currency,
    destination: wallet.stripe_connected_account_id,
  });
  return { payoutProviderId: transfer.id, status: "PROCESSING" };
}

/**
 * Creates a Stripe Connect "Express" account for a creator — the lightest
 * onboarding option, where Stripe hosts the KYC/bank-details form and
 * dashboard. Called once per creator, the first time they start payout
 * setup; the resulting account id is stored on their wallet row by
 * stripeConnectService so this is never called twice for the same creator.
 */
async function createConnectedAccount({ userId, email }) {
  const account = await stripeRequest("POST", "/accounts", {
    type: "express",
    "capabilities[transfers][requested]": "true",
    "metadata[userId]": userId,
    ...(email ? { email } : {}),
  });
  return { accountId: account.id };
}

/**
 * An Account Link is a single-use, short-lived (a few minutes) URL to
 * Stripe's hosted onboarding flow. `refreshUrl` is where Stripe sends the
 * user if the link expired before they finished (we just re-request a new
 * one there); `returnUrl` is where they land after completing (or leaving)
 * the flow — completion itself is confirmed separately via the
 * `account.updated` webhook, never assumed just because the user was
 * redirected back.
 */
async function createAccountLink({ accountId, refreshUrl, returnUrl }) {
  const link = await stripeRequest("POST", "/account_links", {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return { url: link.url };
}

/** Used by stripeConnectService to double check status on demand (in addition to relying on the account.updated webhook). */
async function getConnectedAccount(accountId) {
  const account = await stripeRequest("GET", `/accounts/${accountId}`);
  return { id: account.id, payoutsEnabled: !!account.payouts_enabled, chargesEnabled: !!account.charges_enabled, detailsSubmitted: !!account.details_submitted };
}

module.exports = {
  name: "stripe",
  createPaymentIntent,
  verifyWebhookSignature,
  buildTestWebhookEvent,
  createRefund,
  createPayout,
  // Connect onboarding — Stripe-specific, not part of the abstract 5-function
  // interface above (the mock provider has no equivalent concept), so these
  // are called directly by stripeConnectService.js rather than through
  // getProvider(). Only meaningful when PAYMENT_PROVIDER=stripe.
  createConnectedAccount,
  createAccountLink,
  getConnectedAccount,
};
