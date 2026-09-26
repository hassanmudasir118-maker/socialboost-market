const express = require("express");
const { z } = require("zod");
const { all } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { centsToDollars, dollarsToCents } = require("../utils/money");
const walletService = require("../services/walletService");
const withdrawalService = require("../services/withdrawalService");
const auditService = require("../services/auditService");
const stripeConnectService = require("../services/stripeConnectService");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

function serializeWallet(w) {
  return {
    balance: centsToDollars(w.balance_cents),
    pending: centsToDollars(w.pending_cents),
    totalEarned: centsToDollars(w.total_earned_cents),
    updatedAt: w.updated_at,
  };
}
function serializeLedgerEntry(l) {
  return {
    id: l.id,
    direction: l.direction,
    reason: l.reason,
    amount: centsToDollars(l.amount_cents),
    balanceAfter: centsToDollars(l.balance_after_cents),
    referenceType: l.reference_type,
    referenceId: l.reference_id,
    createdAt: l.created_at,
  };
}
function serializeWithdrawal(w) {
  return {
    id: w.id,
    amount: centsToDollars(w.amount_cents),
    fee: centsToDollars(w.fee_cents),
    net: centsToDollars(w.net_cents),
    status: w.status,
    requestedAt: w.requested_at,
    decidedAt: w.decided_at,
  };
}

// GET /api/wallet — my wallet + recent ledger entries (server is the only
// source of truth for the balance; the client never supplies or overrides it)
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const wallet = await walletService.getWallet(req.user.id);
  const ledger = await walletService.getLedger(req.user.id, 30);
  res.json({ wallet: serializeWallet(wallet), ledger: ledger.map(serializeLedgerEntry) });
}));

router.get("/withdrawals", requireAuth, asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY requested_at DESC", [req.user.id]);
  res.json({ withdrawals: rows.map(serializeWithdrawal) });
}));

const withdrawSchema = z.object({ amount: z.number().positive() });
router.post("/withdrawals", requireAuth, validate(withdrawSchema), async (req, res) => {
  try {
    const { withdrawal } = await withdrawalService.requestWithdrawal({ userId: req.user.id, amountCents: dollarsToCents(req.body.amount) });
    await auditService.log({ actorId: req.user.id, actorRole: req.user.role, action: "Requested withdrawal", targetType: "Withdrawal", targetId: withdrawal.id, details: `$${req.body.amount}` });
    res.status(201).json({ withdrawal: serializeWithdrawal(withdrawal) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to request withdrawal" });
  }
});

// ---------------------------------------------------------------------------
// Stripe Connect payout onboarding (creators only) — see stripeConnectService.js
// ---------------------------------------------------------------------------
router.get("/payouts/status", requireAuth, asyncHandler(async (req, res) => {
  res.json(await stripeConnectService.getStatus(req.user.id));
}));

router.post("/payouts/onboarding", requireAuth, async (req, res) => {
  try {
    const result = await stripeConnectService.beginOnboarding({ userId: req.user.id, email: req.user.email });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to start payout setup" });
  }
});

module.exports = router;
