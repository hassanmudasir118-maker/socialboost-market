const { get, run, transaction, nowIso } = require("../db");
const { newId } = require("../utils/ids");
const { applyBps } = require("../utils/money");
const { getProvider } = require("./paymentProvider");
const settingsService = require("./settingsService");
const escrowService = require("./escrowService");
const statusService = require("./campaignStatusService");
const notificationService = require("./notificationService");
const auditService = require("./auditService");

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const TEST_MODE = (process.env.PAYMENT_TEST_MODE ?? "true") !== "false";
const CURRENCY = process.env.PAYMENT_CURRENCY || "usd";

/**
 * Creates a payment intent for funding a campaign. This does NOT touch
 * escrow — escrow is only ever funded by a verified webhook event (see
 * processWebhookEvent below). Commission (with any promo code) is computed
 * and snapshotted here, server-side, so the checkout page shows the exact
 * breakdown that will actually be charged.
 */
async function createCampaignCheckout({ campaignId, advertiserId, promoCode, idempotencyKey }) {
  return transaction(async () => {
    const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [campaignId]);
    if (!campaign) throw httpError(404, "Campaign not found");
    if (campaign.advertiser_id !== advertiserId) throw httpError(403, "Not your campaign");
    if (campaign.status !== "PENDING_PAYMENT") throw httpError(400, `Campaign must be Pending Payment to check out (currently ${campaign.status})`);

    // Idempotency: replaying the same client-supplied key returns the existing
    // pending payment instead of creating a second payment intent.
    if (idempotencyKey) {
      const existing = await get("SELECT * FROM payments WHERE idempotency_key = ?", [idempotencyKey]);
      if (existing) return { payment: existing, alreadyExisted: true };
    }

    const settings = await settingsService.getSettings();
    let commissionBps = settings.commission_bps;
    let appliedPromo = null;
    if (promoCode) {
      const promo = await get("SELECT * FROM promo_codes WHERE code = ? AND active = 1", [String(promoCode).toUpperCase()]);
      if (!promo) throw httpError(400, "Invalid or expired promo code");
      commissionBps = Math.max(0, commissionBps - promo.discount_bps);
      appliedPromo = promo.code;
    }
    await run("UPDATE campaigns SET commission_bps = ?, promo_code = ? WHERE id = ?", [commissionBps, appliedPromo, campaignId]);

    const feeCents = applyBps(campaign.budget_cents, commissionBps);
    const creatorAllocationCents = campaign.budget_cents - feeCents;

    const provider = getProvider();
    const intent = await provider.createPaymentIntent({
      amountCents: campaign.budget_cents, currency: CURRENCY, campaignId, userId: advertiserId,
      metadata: { campaignId, advertiserId },
    });

    const id = newId("pay");
    const ts = nowIso();
    await run(
      `INSERT INTO payments (id, campaign_id, user_id, provider, provider_payment_id, amount_cents, currency,
         platform_fee_cents, creator_allocation_cents, status, test_mode, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
      [
        id, campaignId, advertiserId, provider.name, intent.providerPaymentId, campaign.budget_cents, CURRENCY,
        feeCents, creatorAllocationCents, TEST_MODE ? 1 : 0, idempotencyKey || null, ts, ts,
      ]
    );

    await auditService.log({ actorId: advertiserId, actorRole: "ADVERTISER", action: "Payment initiated", targetType: "Payment", targetId: id, campaignId, details: `$${(campaign.budget_cents / 100).toFixed(2)} via ${provider.name}` });

    return { payment: await get("SELECT * FROM payments WHERE id = ?", [id]), clientSecret: intent.clientSecret, alreadyExisted: false };
  });
}

/**
 * The single entry point for provider webhook events, used by BOTH the real
 * `/api/payments/webhook` route and the test-mode simulator — guaranteeing
 * test and production traffic run through identical verification and
 * idempotency logic. Returns a small result object; never throws for
 * "already processed" (that's a successful no-op, matching what a real
 * provider expects on a retried delivery).
 */
async function processWebhookEvent({ rawBody, signature }) {
  const provider = getProvider();
  const valid = await provider.verifyWebhookSignature(rawBody, signature, process.env.PAYMENT_WEBHOOK_SECRET);
  if (!valid) throw httpError(400, "Invalid webhook signature");

  let event;
  try { event = JSON.parse(rawBody); } catch (_) { throw httpError(400, "Malformed webhook payload"); }

  return transaction(async () => {
    // provider_event_id is UNIQUE (see webhook_events schema), so this SELECT
    // ... FOR UPDATE plus the unique constraint together make concurrent
    // deliveries of the exact same event id safe: the second delivery either
    // sees the first's committed row (and short-circuits below) or gets a
    // unique-violation on INSERT, which the caller treats as a benign retry.
    const existing = await get("SELECT * FROM webhook_events WHERE provider = ? AND provider_event_id = ? FOR UPDATE", [provider.name, event.id]);
    if (existing && existing.status === "PROCESSED") {
      return { ok: true, duplicate: true };
    }

    const ts = nowIso();
    const providerObjectId = event.data?.object?.id;

    // account.updated (Stripe Connect payout onboarding) is a different kind
    // of event entirely — it's about a connected ACCOUNT, not a payment, so
    // it's dispatched before the "find a matching payment" logic below,
    // which would otherwise always miss for this event type.
    if (event.type === "account.updated") {
      return handleTypedWebhook({ event, provider, existing, rawBody, ts, paymentId: null, handler: () => require("./stripeConnectService").handleAccountUpdated(event.data.object) });
    }

    const payment = await get("SELECT * FROM payments WHERE provider_payment_id = ?", [providerObjectId]);

    let webhookRowId;
    if (existing) {
      webhookRowId = existing.id;
      await run("UPDATE webhook_events SET status='RECEIVED', error=NULL, received_at=? WHERE id=?", [ts, webhookRowId]);
    } else {
      webhookRowId = newId("whk");
      await run(
        `INSERT INTO webhook_events (id, provider, provider_event_id, event_type, payment_id, payload, status, received_at)
         VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', ?)`,
        [webhookRowId, provider.name, event.id, event.type, payment?.id || null, rawBody, ts]
      );
    }

    try {
      if (!payment) throw new Error(`No payment found for provider_payment_id ${providerObjectId}`);

      if (event.type === "payment_intent.succeeded") await handlePaymentSucceeded(payment);
      else if (event.type === "payment_intent.payment_failed") await handlePaymentFailed(payment, "Payment declined by provider");
      else if (event.type === "payment_intent.canceled") await handlePaymentCancelled(payment);
      else { await run("UPDATE webhook_events SET status='IGNORED', processed_at=? WHERE id=?", [nowIso(), webhookRowId]); return { ok: true, ignored: true }; }

      await run("UPDATE webhook_events SET status='PROCESSED', processed_at=? WHERE id=?", [nowIso(), webhookRowId]);
      return { ok: true };
    } catch (err) {
      await run("UPDATE webhook_events SET status='FAILED', error=?, processed_at=? WHERE id=?", [err.message, nowIso(), webhookRowId]);
      throw httpError(err.status || 500, err.message);
    }
  });
}

/** Shared bookkeeping (webhook_events row lifecycle) for event types that aren't about a `payments` row, e.g. account.updated. */
async function handleTypedWebhook({ event, provider, existing, rawBody, ts, paymentId, handler }) {
  let webhookRowId;
  if (existing) {
    webhookRowId = existing.id;
    await run("UPDATE webhook_events SET status='RECEIVED', error=NULL, received_at=? WHERE id=?", [ts, webhookRowId]);
  } else {
    webhookRowId = newId("whk");
    await run(
      `INSERT INTO webhook_events (id, provider, provider_event_id, event_type, payment_id, payload, status, received_at)
       VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', ?)`,
      [webhookRowId, provider.name, event.id, event.type, paymentId, rawBody, ts]
    );
  }
  try {
    await handler();
    await run("UPDATE webhook_events SET status='PROCESSED', processed_at=? WHERE id=?", [nowIso(), webhookRowId]);
    return { ok: true };
  } catch (err) {
    await run("UPDATE webhook_events SET status='FAILED', error=?, processed_at=? WHERE id=?", [err.message, nowIso(), webhookRowId]);
    throw httpError(err.status || 500, err.message);
  }
}

async function handlePaymentSucceeded(payment) {
  if (payment.status === "SUCCEEDED") return; // idempotent no-op — already applied
  const ts = nowIso();
  await run("UPDATE payments SET status='SUCCEEDED', updated_at=? WHERE id=?", [ts, payment.id]);

  // Escrow is funded ONLY here, driven by a verified webhook — never by a
  // frontend "payment succeeded" claim.
  await escrowService.fund(payment.campaign_id, payment.amount_cents);

  const txnId = newId("txn");
  await run(
    `INSERT INTO transactions (id, type, status, user_id, campaign_id, payment_id, amount_cents, platform_fee_cents, net_cents, currency, created_at)
     VALUES (?, 'CAMPAIGN_FUNDING', 'HELD_IN_ESCROW', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [txnId, payment.user_id, payment.campaign_id, payment.id, payment.amount_cents, payment.platform_fee_cents, payment.amount_cents - payment.platform_fee_cents, payment.currency, ts]
  );

  const campaign = await statusService.transitionCampaign(payment.campaign_id, "FUNDED", { actorId: null, note: `Payment ${payment.id} succeeded (webhook)` });
  await notificationService.notify(payment.user_id, { icon: "payment", title: "Campaign funded", body: `"${campaign.title}" is funded and ready to publish.` });
  await auditService.log({ actorId: null, actorRole: "SYSTEM", action: "Payment succeeded — escrow funded", targetType: "Payment", targetId: payment.id, campaignId: payment.campaign_id, details: `$${(payment.amount_cents / 100).toFixed(2)}` });
}

async function handlePaymentFailed(payment, reason) {
  if (payment.status === "FAILED" || payment.status === "SUCCEEDED") return;
  await run("UPDATE payments SET status='FAILED', failure_reason=?, updated_at=? WHERE id=?", [reason, nowIso(), payment.id]);
  await notificationService.notify(payment.user_id, { icon: "alert", title: "Payment failed", body: reason });
  await auditService.log({ actorId: null, actorRole: "SYSTEM", action: "Payment failed", targetType: "Payment", targetId: payment.id, campaignId: payment.campaign_id, details: reason });
}

async function handlePaymentCancelled(payment) {
  if (payment.status === "SUCCEEDED") return;
  await run("UPDATE payments SET status='CANCELLED', updated_at=? WHERE id=?", [nowIso(), payment.id]);
  await auditService.log({ actorId: null, actorRole: "SYSTEM", action: "Payment cancelled", targetType: "Payment", targetId: payment.id, campaignId: payment.campaign_id });
}

// ---------------------------------------------------------------------------
// Manual, human-confirmed payment methods (e.g. EasyPaisa/JazzCash personal
// or merchant account, bank transfer) — for when no automated payment-intent
// provider is configured for a method. The advertiser sends money themselves
// outside this system and submits a reference; escrow is only ever funded
// once an authenticated admin confirms it via resolveManualPayment. Never
// trust a client-submitted "I paid" claim on its own (§ same principle as
// the webhook-only rule in handlePaymentSucceeded above).
// ---------------------------------------------------------------------------

const MANUAL_ACCOUNTS = {
  EASYPAISA: {
    label: "EasyPaisa",
    accountName: process.env.PLATFORM_EASYPAISA_NAME || "",
    accountNumber: process.env.PLATFORM_EASYPAISA_NUMBER || "",
  },
  JAZZCASH: {
    label: "JazzCash",
    accountName: process.env.PLATFORM_JAZZCASH_NAME || "",
    accountNumber: process.env.PLATFORM_JAZZCASH_NUMBER || "",
  },
  BANK_TRANSFER: {
    label: "Bank Transfer",
    accountName: process.env.PLATFORM_BANK_ACCOUNT_NAME || "",
    accountNumber: process.env.PLATFORM_BANK_ACCOUNT_NUMBER || "",
    bankName: process.env.PLATFORM_BANK_NAME || "",
  },
};

function getManualMethods() {
  // Only methods whose receiving-account env vars are actually filled in are
  // offered — an unconfigured method shows nowhere rather than silently
  // offering a blank account to pay into.
  return Object.entries(MANUAL_ACCOUNTS)
    .filter(([, acc]) => acc.accountNumber)
    .map(([method, acc]) => ({ method, ...acc }));
}

/** Creates a PENDING payment for a manual (human-confirmed) method, same fee/escrow bookkeeping as createCampaignCheckout, but with no provider API call. */
async function createManualCheckout({ campaignId, advertiserId, method, idempotencyKey }) {
  const account = MANUAL_ACCOUNTS[method];
  if (!account || !account.accountNumber) throw httpError(400, `Manual payment method "${method}" is not configured`);

  return transaction(async () => {
    const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [campaignId]);
    if (!campaign) throw httpError(404, "Campaign not found");
    if (campaign.advertiser_id !== advertiserId) throw httpError(403, "Not your campaign");
    if (campaign.status !== "PENDING_PAYMENT") throw httpError(400, `Campaign must be Pending Payment to check out (currently ${campaign.status})`);

    if (idempotencyKey) {
      const existing = await get("SELECT * FROM payments WHERE idempotency_key = ?", [idempotencyKey]);
      if (existing) return { payment: existing, account, alreadyExisted: true };
    }

    const settings = await settingsService.getSettings();
    let commissionBps = settings.commission_bps;
    let appliedPromo = null;
    if (campaign.promo_code) { commissionBps = campaign.commission_bps; appliedPromo = campaign.promo_code; }
    const feeCents = applyBps(campaign.budget_cents, commissionBps);
    const creatorAllocationCents = campaign.budget_cents - feeCents;

    const id = newId("pay");
    const ts = nowIso();
    await run(
      `INSERT INTO payments (id, campaign_id, user_id, provider, provider_payment_id, amount_cents, currency,
         platform_fee_cents, creator_allocation_cents, status, test_mode, idempotency_key, payment_method,
         manual_review_status, created_at, updated_at)
       VALUES (?, ?, ?, 'manual', NULL, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'AWAITING_REFERENCE', ?, ?)`,
      [id, campaignId, advertiserId, campaign.budget_cents, CURRENCY, feeCents, creatorAllocationCents, TEST_MODE ? 1 : 0, idempotencyKey || null, method, ts, ts]
    );

    await auditService.log({ actorId: advertiserId, actorRole: "ADVERTISER", action: "Manual payment initiated", targetType: "Payment", targetId: id, campaignId, details: `$${(campaign.budget_cents / 100).toFixed(2)} via ${method} (manual)` });

    return { payment: await get("SELECT * FROM payments WHERE id = ?", [id]), account, alreadyExisted: false };
  });
}

/** Advertiser submits the transaction reference after sending the money themselves. Does NOT fund escrow — only moves the payment to PENDING_REVIEW for an admin to check. */
async function submitManualProof({ paymentId, advertiserId, reference, note }) {
  return transaction(async () => {
    const payment = await get("SELECT * FROM payments WHERE id = ? FOR UPDATE", [paymentId]);
    if (!payment) throw httpError(404, "Payment not found");
    if (payment.user_id !== advertiserId) throw httpError(403, "Not your payment");
    if (payment.provider !== "manual") throw httpError(400, "This payment is not a manual-method payment");
    if (payment.status !== "PENDING") throw httpError(400, "This payment has already been resolved");
    if (!reference || !String(reference).trim()) throw httpError(400, "A transaction reference is required");

    await run(
      "UPDATE payments SET manual_reference=?, manual_note=?, manual_review_status='PENDING_REVIEW', updated_at=? WHERE id=?",
      [String(reference).trim(), note || null, nowIso(), paymentId]
    );
    await auditService.log({ actorId: advertiserId, actorRole: "ADVERTISER", action: "Manual payment reference submitted", targetType: "Payment", targetId: paymentId, campaignId: payment.campaign_id, details: String(reference).trim() });
    return get("SELECT * FROM payments WHERE id = ?", [paymentId]);
  });
}

/** Admin-only. Confirming funds escrow exactly like a real webhook would (handlePaymentSucceeded); rejecting marks the payment FAILED with no escrow funding. */
async function resolveManualPayment({ paymentId, adminId, confirm, reason }) {
  return transaction(async () => {
    const payment = await get("SELECT * FROM payments WHERE id = ? FOR UPDATE", [paymentId]);
    if (!payment) throw httpError(404, "Payment not found");
    if (payment.provider !== "manual") throw httpError(400, "This payment is not a manual-method payment");
    if (payment.status !== "PENDING") throw httpError(400, "This payment has already been resolved");
    if (payment.manual_review_status !== "PENDING_REVIEW") throw httpError(400, "Advertiser has not submitted a payment reference yet");

    const ts = nowIso();
    if (confirm) {
      await run("UPDATE payments SET manual_review_status='CONFIRMED', manual_reviewed_by=?, manual_reviewed_at=?, updated_at=? WHERE id=?", [adminId, ts, ts, paymentId]);
      // Re-read so handlePaymentSucceeded sees the just-written manual_review_status.
      const updated = await get("SELECT * FROM payments WHERE id = ?", [paymentId]);
      await handlePaymentSucceeded(updated);
      await auditService.log({ actorId: adminId, actorRole: "ADMIN", action: "Manual payment confirmed — escrow funded", targetType: "Payment", targetId: paymentId, campaignId: payment.campaign_id, details: `$${(payment.amount_cents / 100).toFixed(2)}` });
    } else {
      await run("UPDATE payments SET status='FAILED', failure_reason=?, manual_review_status='REJECTED', manual_reviewed_by=?, manual_reviewed_at=?, updated_at=? WHERE id=?", [reason || "Manual payment not confirmed", adminId, ts, ts, paymentId]);
      await notificationService.notify(payment.user_id, { icon: "alert", title: "Payment not confirmed", body: reason || "We could not confirm your manual payment. Please contact support." });
      await auditService.log({ actorId: adminId, actorRole: "ADMIN", action: "Manual payment rejected", targetType: "Payment", targetId: paymentId, campaignId: payment.campaign_id, details: reason || "" });
    }
    return get("SELECT * FROM payments WHERE id = ?", [paymentId]);
  });
}

/** Test-mode only: builds and immediately submits a signed webhook event, exactly as if the provider had sent it. */
async function simulateWebhook({ paymentId, outcome }) {
  if (!TEST_MODE) throw httpError(403, "Webhook simulation is only available in test mode");
  const payment = await get("SELECT * FROM payments WHERE id = ?", [paymentId]);
  if (!payment) throw httpError(404, "Payment not found");
  const provider = getProvider();
  const { payload, signature } = await provider.buildTestWebhookEvent({ providerPaymentId: payment.provider_payment_id, outcome });
  return processWebhookEvent({ rawBody: payload, signature });
}

module.exports = {
  createCampaignCheckout, processWebhookEvent, simulateWebhook, TEST_MODE, httpError,
  getManualMethods, createManualCheckout, submitManualProof, resolveManualPayment,
};
