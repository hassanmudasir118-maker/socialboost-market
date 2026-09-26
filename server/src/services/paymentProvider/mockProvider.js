const crypto = require("crypto");

/**
 * Mock payment provider — implements the exact same interface a real Stripe
 * (or similar) adapter would. Swapping to a real provider means writing one
 * more file that satisfies this interface and changing PAYMENT_PROVIDER in
 * .env; nothing else in the codebase needs to change (see README).
 *
 * Signature verification here uses HMAC-SHA256 over the raw payload with
 * PAYMENT_WEBHOOK_SECRET, the same shape Stripe/most providers use — so the
 * verification code path is realistic even though the events are self-issued
 * in test mode.
 */
function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function createPaymentIntent({ amountCents, currency, campaignId, userId, metadata }) {
  const id = `mock_pi_${crypto.randomBytes(12).toString("hex")}`;
  return {
    providerPaymentId: id,
    clientSecret: `${id}_secret_${crypto.randomBytes(8).toString("hex")}`,
    amountCents,
    currency,
    status: "PENDING",
  };
}

/**
 * In real life, the advertiser is redirected to the provider's hosted
 * checkout and the provider calls our webhook asynchronously once they pay.
 * In test mode there is no real checkout UI to complete, so this function
 * builds the webhook EVENT the provider would have sent — it does not touch
 * our database. The caller must still POST it to the webhook endpoint (or
 * call processWebhookEvent) so the exact same verified, idempotent code path
 * runs regardless of whether the event came from a real provider or here.
 */
function buildTestWebhookEvent({ providerPaymentId, outcome = "succeeded" }) {
  const eventTypeMap = { succeeded: "payment_intent.succeeded", failed: "payment_intent.payment_failed", cancelled: "payment_intent.canceled" };
  const event = {
    id: `mock_evt_${crypto.randomBytes(12).toString("hex")}`,
    type: eventTypeMap[outcome] || "payment_intent.succeeded",
    data: { object: { id: providerPaymentId } },
    created: Math.floor(Date.now() / 1000),
  };
  const payload = JSON.stringify(event);
  const signature = sign(payload, process.env.PAYMENT_WEBHOOK_SECRET);
  return { payload, signature };
}

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected = sign(rawBody, secret);
  // Constant-time comparison — avoids leaking timing information about the secret.
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch (_) {
    return false;
  }
}

function createRefund({ providerPaymentId, amountCents }) {
  return { providerRefundId: `mock_re_${crypto.randomBytes(12).toString("hex")}`, amountCents, status: "SUCCEEDED" };
}

/** Payout provider side (for withdrawals — §11). Simulates an async payout. */
function createPayout({ amountCents, currency, destination }) {
  return { payoutProviderId: `mock_po_${crypto.randomBytes(12).toString("hex")}`, status: "PROCESSING" };
}

module.exports = {
  name: "mock",
  createPaymentIntent,
  buildTestWebhookEvent,
  verifyWebhookSignature,
  createRefund,
  createPayout,
};
