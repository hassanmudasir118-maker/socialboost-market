const express = require("express");
const { z } = require("zod");
const { get, all, run, nowIso } = require("../db");
const { newId } = require("../utils/ids");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const membershipService = require("../services/membershipService");
const notificationService = require("../services/notificationService");
const auditService = require("../services/auditService");
const gateway = require("../services/paymentGatewayService");

const router = express.Router();

function serializePlan(p) {
  return {
    id: p.id,
    name: p.name,
    price: p.price_cents / 100,
    commissionDiscountPercent: p.commission_discount_bps / 100,
    description: p.description,
  };
}

// Plans, your current plan, and where to send the payment.
router.get("/", requireAuth, requireRole("ADVERTISER"), asyncHandler(async (req, res) => {
  const [plans, active, pending] = await Promise.all([
    membershipService.listPlans(),
    membershipService.getActivePlan(req.user.id),
    get("SELECT * FROM membership_requests WHERE user_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1", [req.user.id]),
  ]);
  res.json({
    plans: plans.map(serializePlan),
    current: { plan: serializePlan(active.plan), expiresAt: active.expiresAt },
    pendingRequest: pending ? { id: pending.id, planId: pending.plan_id, createdAt: pending.created_at } : null,
    durationDays: membershipService.PLAN_DAYS,
    payTo: gateway.getManualMethods().map((a) => ({ method: a.method, accountName: a.accountName, accountNumber: a.accountNumber })),
  });
}));

const requestSchema = z.object({ planId: z.enum(["PRO", "VIP"]), paymentReference: z.string().min(3).max(120) });
router.post("/request", requireAuth, requireRole("ADVERTISER"), validate(requestSchema), asyncHandler(async (req, res) => {
  const existing = await get("SELECT id FROM membership_requests WHERE user_id = ? AND status = 'PENDING'", [req.user.id]);
  if (existing) return res.status(409).json({ error: "You already have a request waiting for the admin to check." });
  const id = newId("mrq");
  await run(
    "INSERT INTO membership_requests (id, user_id, plan_id, payment_reference, status, created_at) VALUES (?, ?, ?, ?, 'PENDING', ?)",
    [id, req.user.id, req.body.planId, req.body.paymentReference.trim(), nowIso()]
  );
  await auditService.log({ actorId: req.user.id, actorRole: req.user.role, action: "Requested membership", targetType: "Membership", targetId: id, details: req.body.planId });
  require("../services/assistantService").alertAdmin("A membership request is waiting for your check (Admin > Assistant).");
  res.status(201).json({ ok: true, id });
}));

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
router.get("/admin/requests", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT r.*, u.email, p.display_name FROM membership_requests r
     JOIN users u ON u.id = r.user_id LEFT JOIN profiles p ON p.user_id = r.user_id
     ORDER BY CASE WHEN r.status = 'PENDING' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 100`
  );
  const members = await all(
    `SELECT u.id, u.email, u.membership_plan, u.membership_expires_at, p.display_name FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.membership_plan <> 'FREE' ORDER BY u.membership_expires_at DESC LIMIT 100`
  );
  res.json({
    requests: rows.map((r) => ({ id: r.id, userId: r.user_id, email: r.email, name: r.display_name, planId: r.plan_id, paymentReference: r.payment_reference, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at })),
    members: members.map((m) => ({ userId: m.id, email: m.email, name: m.display_name, planId: m.membership_plan, expiresAt: m.membership_expires_at })),
  });
}));

router.post("/admin/requests/:id/approve", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const r = await get("SELECT * FROM membership_requests WHERE id = ?", [req.params.id]);
  if (!r) return res.status(404).json({ error: "Request not found" });
  if (r.status !== "PENDING") return res.status(400).json({ error: "This request was already handled" });
  try {
    await membershipService.grantPlan(r.user_id, r.plan_id);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  await run("UPDATE membership_requests SET status = 'APPROVED', resolved_at = ? WHERE id = ?", [nowIso(), r.id]);
  await notificationService.notify(r.user_id, { icon: "star", title: "Membership active", body: `Your ${r.plan_id} plan is active for ${membershipService.PLAN_DAYS} days.` });
  await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Approved membership", targetType: "Membership", targetId: r.id, details: `${r.plan_id} for ${r.user_id}` });
  res.json({ ok: true });
}));

router.post("/admin/requests/:id/reject", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const r = await get("SELECT * FROM membership_requests WHERE id = ?", [req.params.id]);
  if (!r) return res.status(404).json({ error: "Request not found" });
  if (r.status !== "PENDING") return res.status(400).json({ error: "This request was already handled" });
  await run("UPDATE membership_requests SET status = 'REJECTED', resolved_at = ? WHERE id = ?", [nowIso(), r.id]);
  await notificationService.notify(r.user_id, { icon: "alert", title: "Membership not activated", body: "We could not confirm your payment. Please check the reference and try again." });
  await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Rejected membership", targetType: "Membership", targetId: r.id });
  res.json({ ok: true });
}));

module.exports = router;
