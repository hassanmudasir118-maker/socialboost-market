const express = require("express");
const { z } = require("zod");
const { get } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const gateway = require("../services/paymentGatewayService");
const escrowService = require("../services/escrowService");
const { centsToDollars } = require("../utils/money");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

function serializePayment(p) {
  return {
    id: p.id, campaignId: p.campaign_id, provider: p.provider, providerPaymentId: p.provider_payment_id,
    amount: centsToDollars(p.amount_cents), currency: p.currency, platformFee: centsToDollars(p.platform_fee_cents),
    creatorAllocation: centsToDollars(p.creator_allocation_cents), status: p.status, testMode: !!p.test_mode,
    failureReason: p.failure_reason, refunded: centsToDollars(p.refunded_cents), createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Checkout — creates a payment intent. Frontend uses the returned
// clientSecret with the provider's hosted checkout UI in production; in test
// mode it calls /test/simulate below instead of a real card form.
// ---------------------------------------------------------------------------
const checkoutSchema = z.object({ campaignId: z.string().min(1), promoCode: z.string().optional().nullable(), idempotencyKey: z.string().optional().nullable() });
router.post("/checkout", requireAuth, requireRole("ADVERTISER"), validate(checkoutSchema), async (req, res) => {
  try {
    const result = await gateway.createCampaignCheckout({
      campaignId: req.body.campaignId, advertiserId: req.user.id,
      promoCode: req.body.promoCode, idempotencyKey: req.body.idempotencyKey,
    });
    res.status(201).json({ payment: serializePayment(result.payment), clientSecret: result.clientSecret, alreadyExisted: result.alreadyExisted });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to create checkout" });
  }
});

// ---------------------------------------------------------------------------
// Manual (human-confirmed) payment methods — e.g. EasyPaisa/JazzCash
// personal account, bank transfer. Used when no automated payment-intent
// provider is configured for that method; see paymentGatewayService.js for
// why escrow is never funded from client-submitted data alone.
// ---------------------------------------------------------------------------
function serializeManualAccount(a) {
  return { method: a.method, label: a.label, accountName: a.accountName, accountNumber: a.accountNumber, bankName: a.bankName };
}

router.get("/manual/methods", requireAuth, (req, res) => {
  res.json({ methods: gateway.getManualMethods().map(serializeManualAccount) });
});

const manualCheckoutSchema = z.object({
  campaignId: z.string().min(1),
  method: z.enum(["EASYPAISA", "JAZZCASH", "BANK_TRANSFER"]),
  idempotencyKey: z.string().optional().nullable(),
});
router.post("/manual-checkout", requireAuth, requireRole("ADVERTISER"), validate(manualCheckoutSchema), async (req, res) => {
  try {
    const result = await gateway.createManualCheckout({
      campaignId: req.body.campaignId, advertiserId: req.user.id,
      method: req.body.method, idempotencyKey: req.body.idempotencyKey,
    });
    res.status(201).json({ payment: serializePayment(result.payment), account: serializeManualAccount({ method: req.body.method, ...result.account }), alreadyExisted: result.alreadyExisted });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to create manual checkout" });
  }
});

const manualProofSchema = z.object({ reference: z.string().min(1), note: z.string().optional().nullable() });
router.post("/:id/manual-proof", requireAuth, requireRole("ADVERTISER"), validate(manualProofSchema), async (req, res) => {
  try {
    const payment = await gateway.submitManualProof({ paymentId: req.params.id, advertiserId: req.user.id, reference: req.body.reference, note: req.body.note });
    res.json({ payment: serializePayment(payment) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to submit payment reference" });
  }
});

router.get("/:id", requireAuth, asyncHandler(async (req, res) => {
  const p = await get("SELECT * FROM payments WHERE id = ?", [req.params.id]);
  if (!p) return res.status(404).json({ error: "Payment not found" });
  if (p.user_id !== req.user.id && req.user.role !== "ADMIN") return res.status(403).json({ error: "Not authorized" });
  res.json({ payment: serializePayment(p) });
}));

router.get("/campaign/:campaignId/escrow", requireAuth, asyncHandler(async (req, res) => {
  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [req.params.campaignId]);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  if (campaign.advertiser_id !== req.user.id && req.user.role !== "ADMIN") return res.status(403).json({ error: "Not authorized" });
  res.json({ escrow: await escrowService.summary(campaign.id) });
}));

// ---------------------------------------------------------------------------
// Webhook — the real integration point. Reads the RAW body (see app.js,
// which mounts this route with express.raw() before the JSON parser) so the
// signature can be verified against exactly what the provider sent.
// ---------------------------------------------------------------------------
router.post("/webhook", async (req, res) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);
    const signature = req.headers["x-payment-signature"];
    const result = await gateway.processWebhookEvent({ rawBody, signature });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Webhook processing failed" });
  }
});

// ---------------------------------------------------------------------------
// Test mode only — simulates the provider calling our webhook. Disabled
// automatically outside test mode (see paymentGatewayService.simulateWebhook).
// ---------------------------------------------------------------------------
const simulateSchema = z.object({ paymentId: z.string().min(1), outcome: z.enum(["succeeded", "failed", "cancelled"]).optional().default("succeeded") });
router.post("/test/simulate", requireAuth, requireRole("ADVERTISER"), validate(simulateSchema), async (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).json({ error: "Not found" });
  try {
    const payment = await get("SELECT * FROM payments WHERE id = ?", [req.body.paymentId]);
    if (!payment || payment.user_id !== req.user.id) return res.status(403).json({ error: "Not your payment" });
    const result = await gateway.simulateWebhook({ paymentId: req.body.paymentId, outcome: req.body.outcome });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to simulate webhook" });
  }
});

router.get("/config/public", requireAuth, (req, res) => {
  // Only the publishable key and provider name ever reach the frontend — the
  // secret key and webhook secret never leave the server.
  res.json({ provider: process.env.PAYMENT_PROVIDER || "mock", publicKey: process.env.PAYMENT_PUBLIC_KEY || null, currency: process.env.PAYMENT_CURRENCY || "usd", testMode: gateway.TEST_MODE });
});

module.exports = router;
