const express = require("express");
const { z } = require("zod");
const { get, all, run, lockRow, nowIso, transaction } = require("../db");
const { newId } = require("../utils/ids");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const taskService = require("../services/taskService");
const notificationService = require("../services/notificationService");
const auditService = require("../services/auditService");
const gateway = require("../services/paymentGatewayService");

const router = express.Router();
const { RATES, ACTIONS_BY_PLATFORM } = taskService;

function serializeOrder(o, extra = {}) {
  return {
    id: o.id, platform: o.platform, action: o.action, actionLabel: RATES[o.action]?.label || o.action,
    targetUrl: o.target_url, targetName: o.target_name, quantity: o.quantity,
    done: o.done_count, status: o.status,
    price: o.price_per_cents / 100, reward: o.reward_per_cents / 100, total: o.total_cents / 100,
    paymentReference: o.payment_reference, createdAt: o.created_at, ...extra,
  };
}
const guard = (fn) => asyncHandler(async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Rates (any logged-in user)
// ---------------------------------------------------------------------------
router.get("/rates", requireAuth, (req, res) => {
  res.json({
    actions: ACTIONS_BY_PLATFORM,
    rates: Object.fromEntries(Object.entries(RATES).map(([k, v]) => [k, { label: v.label, price: v.price / 100, reward: v.reward / 100 }])),
    payTo: gateway.getManualMethods().map((a) => ({ method: a.method, accountName: a.accountName, accountNumber: a.accountNumber })),
  });
});

// ---------------------------------------------------------------------------
// Advertiser: buy followers / likes
// ---------------------------------------------------------------------------
const createSchema = z.object({
  platform: z.enum(["TIKTOK", "INSTAGRAM", "FACEBOOK", "YOUTUBE"]),
  action: z.enum(["FOLLOW", "SUBSCRIBE", "LIKE"]),
  targetUrl: z.string().min(8).max(500),
  targetName: z.string().max(80).optional().nullable(),
  quantity: z.number().int().min(10).max(10000),
});
router.post("/orders", requireAuth, requireRole("ADVERTISER"), validate(createSchema), guard(async (req, res) => {
  const b = req.body;
  if (!ACTIONS_BY_PLATFORM[b.platform].includes(b.action)) throw taskService.httpError(400, "This action is not available on that platform");
  const url = taskService.validateTargetUrl(b.platform, b.targetUrl);
  const rate = RATES[b.action];
  const id = newId("tor");
  const ts = nowIso();
  await run(
    `INSERT INTO task_orders (id, advertiser_id, platform, action, target_url, target_name, quantity, price_per_cents, reward_per_cents, total_cents, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, ?)`,
    [id, req.user.id, b.platform, b.action, url, b.targetName || null, b.quantity, rate.price, rate.reward, rate.price * b.quantity, ts, ts]
  );
  res.status(201).json({ order: serializeOrder(await get("SELECT * FROM task_orders WHERE id = ?", [id])) });
}));

router.get("/orders", requireAuth, requireRole("ADVERTISER"), guard(async (req, res) => {
  await taskService.settleOverdueClaims();
  const rows = await all(
    `SELECT o.*, (SELECT COUNT(*)::int FROM task_claims c WHERE c.order_id = o.id AND c.status = 'PENDING') AS waiting
     FROM task_orders o WHERE o.advertiser_id = ? ORDER BY o.created_at DESC LIMIT 100`, [req.user.id]);
  res.json({ orders: rows.map((o) => serializeOrder(o, { waiting: o.waiting })) });
}));

const paySchema = z.object({ method: z.enum(["EASYPAISA", "JAZZCASH", "BANK_TRANSFER"]), reference: z.string().min(3).max(120) });
router.post("/orders/:id/payment", requireAuth, requireRole("ADVERTISER"), validate(paySchema), guard(async (req, res) => {
  const o = await get("SELECT * FROM task_orders WHERE id = ? AND advertiser_id = ?", [req.params.id, req.user.id]);
  if (!o) throw taskService.httpError(404, "Order not found");
  if (o.status !== "PENDING_PAYMENT") throw taskService.httpError(400, "This order is not waiting for payment");
  await run("UPDATE task_orders SET status = 'AWAITING_CONFIRMATION', payment_method = ?, payment_reference = ?, updated_at = ? WHERE id = ?",
    [req.body.method, req.body.reference.trim(), nowIso(), o.id]);
  require("../services/assistantService").alertAdmin("A follower/like order payment is waiting for your check (Admin > Assistant).");
  res.json({ ok: true });
}));

router.post("/orders/:id/cancel", requireAuth, requireRole("ADVERTISER"), guard(async (req, res) => {
  const o = await get("SELECT * FROM task_orders WHERE id = ? AND advertiser_id = ?", [req.params.id, req.user.id]);
  if (!o) throw taskService.httpError(404, "Order not found");
  if (o.status !== "PENDING_PAYMENT") throw taskService.httpError(400, "Only an unpaid order can be cancelled. Contact support for a paid order.");
  await run("UPDATE task_orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?", [nowIso(), o.id]);
  res.json({ ok: true });
}));

router.get("/orders/:id/claims", requireAuth, requireRole("ADVERTISER"), guard(async (req, res) => {
  const o = await get("SELECT id FROM task_orders WHERE id = ? AND advertiser_id = ?", [req.params.id, req.user.id]);
  if (!o) throw taskService.httpError(404, "Order not found");
  await taskService.settleOverdueClaims();
  const rows = await all(
    `SELECT id, creator_username, status, claimed_at FROM task_claims WHERE order_id = ? AND status IN ('PENDING','APPROVED','REJECTED') ORDER BY claimed_at DESC LIMIT 200`, [o.id]);
  res.json({
    autoApproveHours: taskService.AUTO_APPROVE_HOURS,
    claims: rows.map((c) => ({ id: c.id, username: c.creator_username, status: c.status, claimedAt: c.claimed_at })),
  });
}));

async function ownClaim(req) {
  const c = await get(
    `SELECT c.id FROM task_claims c JOIN task_orders o ON o.id = c.order_id WHERE c.id = ? AND o.advertiser_id = ?`, [req.params.id, req.user.id]);
  if (!c) throw taskService.httpError(404, "Claim not found");
  return c;
}
router.post("/claims/:id/approve", requireAuth, requireRole("ADVERTISER"), guard(async (req, res) => {
  const c = await ownClaim(req);
  const ok = await taskService.approveClaim(c.id);
  if (!ok) throw taskService.httpError(400, "This claim was already handled");
  res.json({ ok: true });
}));
const rejectSchema = z.object({ reason: z.string().max(200).optional().nullable() });
router.post("/claims/:id/reject", requireAuth, requireRole("ADVERTISER"), validate(rejectSchema), guard(async (req, res) => {
  const c = await ownClaim(req);
  const ok = await taskService.rejectClaim(c.id, req.body.reason);
  if (!ok) throw taskService.httpError(400, "This claim was already handled");
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Creator: do tasks and earn
// ---------------------------------------------------------------------------
router.get("/available", requireAuth, requireRole("CREATOR"), guard(async (req, res) => {
  await taskService.settleOverdueClaims();
  const rows = await all(
    `SELECT o.*,
        (SELECT COUNT(*)::int FROM task_claims c WHERE c.order_id = o.id AND c.status IN ('PENDING','APPROVED')) AS taken
     FROM task_orders o
     WHERE o.status = 'ACTIVE' AND o.advertiser_id <> ?
       AND NOT EXISTS (SELECT 1 FROM task_claims c WHERE c.order_id = o.id AND c.creator_id = ? AND c.status <> 'STARTED')
     ORDER BY o.created_at LIMIT 60`, [req.user.id, req.user.id]);
  res.json({
    minSeconds: taskService.MIN_SECONDS_ON_TARGET,
    tasks: rows.filter((o) => o.quantity - o.taken > 0).map((o) => ({
      id: o.id, platform: o.platform, action: o.action, actionLabel: RATES[o.action]?.label || o.action,
      targetName: o.target_name, reward: o.reward_per_cents / 100, left: o.quantity - o.taken,
    })),
  });
}));

router.post("/:orderId/start", requireAuth, requireRole("CREATOR"), guard(async (req, res) => {
  const o = await get("SELECT * FROM task_orders WHERE id = ?", [req.params.orderId]);
  if (!o || o.status !== "ACTIVE") throw taskService.httpError(404, "This task is no longer available");
  if (o.advertiser_id === req.user.id) throw taskService.httpError(400, "You cannot do your own task");
  const existing = await get("SELECT * FROM task_claims WHERE order_id = ? AND creator_id = ?", [o.id, req.user.id]);
  if (existing && existing.status !== "STARTED") throw taskService.httpError(409, "You already did this task");
  if (!existing) {
    if ((await taskService.slotsTaken(o.id)) >= o.quantity) throw taskService.httpError(409, "All spots for this task are taken");
    await run("INSERT INTO task_claims (id, order_id, creator_id, status, started_at) VALUES (?, ?, ?, 'STARTED', ?)", [newId("tcl"), o.id, req.user.id, nowIso()]);
  } else {
    await run("UPDATE task_claims SET started_at = ? WHERE id = ?", [nowIso(), existing.id]);
  }
  res.json({ url: o.target_url, minSeconds: taskService.MIN_SECONDS_ON_TARGET });
}));

const claimSchema = z.object({ username: z.string().trim().min(2).max(60) });
router.post("/:orderId/claim", requireAuth, requireRole("CREATOR"), validate(claimSchema), guard(async (req, res) => {
  await transaction(async () => {
    const o = await lockRow("task_orders", "id", req.params.orderId);
    if (!o || o.status !== "ACTIVE") throw taskService.httpError(404, "This task is no longer available");
    const c = await get("SELECT * FROM task_claims WHERE order_id = ? AND creator_id = ?", [o.id, req.user.id]);
    if (!c || c.status !== "STARTED") throw taskService.httpError(400, "Open the task link first");
    const seconds = (Date.now() - new Date(c.started_at).getTime()) / 1000;
    if (seconds < taskService.MIN_SECONDS_ON_TARGET) throw taskService.httpError(400, "Please do the action first, then press Done");
    const since = new Date(Date.now() - 86400000).toISOString();
    const today = await get("SELECT COUNT(*)::int AS n FROM task_claims WHERE creator_id = ? AND claimed_at > ?", [req.user.id, since]);
    if (today.n >= taskService.MAX_CLAIMS_PER_DAY) throw taskService.httpError(429, "Daily task limit reached. Come back tomorrow.");
    if ((await taskService.slotsTaken(o.id)) >= o.quantity) throw taskService.httpError(409, "All spots for this task are taken");
    await run("UPDATE task_claims SET status = 'PENDING', creator_username = ?, claimed_at = ? WHERE id = ?", [req.body.username, nowIso(), c.id]);
  });
  res.json({ ok: true, autoApproveHours: taskService.AUTO_APPROVE_HOURS });
}));

router.get("/my", requireAuth, requireRole("CREATOR"), guard(async (req, res) => {
  await taskService.settleOverdueClaims();
  const rows = await all(
    `SELECT c.id, c.status, c.claimed_at, c.note, o.platform, o.action, o.target_name, o.reward_per_cents
     FROM task_claims c JOIN task_orders o ON o.id = c.order_id
     WHERE c.creator_id = ? AND c.status <> 'STARTED' ORDER BY c.claimed_at DESC LIMIT 100`, [req.user.id]);
  const sum = (s) => rows.filter((r) => r.status === s).reduce((a, r) => a + r.reward_per_cents, 0) / 100;
  res.json({
    totals: { approved: sum("APPROVED"), waiting: sum("PENDING") },
    claims: rows.map((r) => ({ id: r.id, status: r.status, claimedAt: r.claimed_at, note: r.note, platform: r.platform, action: RATES[r.action]?.label || r.action, targetName: r.target_name, reward: r.reward_per_cents / 100 })),
  });
}));

// ---------------------------------------------------------------------------
// Admin: confirm the advertiser's payment
// ---------------------------------------------------------------------------
router.get("/admin/orders", requireAuth, requireRole("ADMIN"), guard(async (req, res) => {
  const rows = await all(
    `SELECT o.*, u.email FROM task_orders o JOIN users u ON u.id = o.advertiser_id
     ORDER BY CASE WHEN o.status = 'AWAITING_CONFIRMATION' THEN 0 ELSE 1 END, o.created_at DESC LIMIT 100`);
  res.json({ orders: rows.map((o) => serializeOrder(o, { email: o.email, paymentMethod: o.payment_method })) });
}));
router.post("/admin/orders/:id/confirm", requireAuth, requireRole("ADMIN"), guard(async (req, res) => {
  const o = await get("SELECT * FROM task_orders WHERE id = ?", [req.params.id]);
  if (!o) throw taskService.httpError(404, "Order not found");
  if (o.status !== "AWAITING_CONFIRMATION") throw taskService.httpError(400, "This order is not waiting for confirmation");
  await run("UPDATE task_orders SET status = 'ACTIVE', updated_at = ? WHERE id = ?", [nowIso(), o.id]);
  await notificationService.notify(o.advertiser_id, { icon: "check", title: "Order is live", body: `Your ${o.quantity} ${RATES[o.action]?.label || o.action} order is now visible to creators.` });
  await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Confirmed task order payment", targetType: "TaskOrder", targetId: o.id, details: `Rs ${o.total_cents / 100}` });
  res.json({ ok: true });
}));
router.post("/admin/orders/:id/reject", requireAuth, requireRole("ADMIN"), guard(async (req, res) => {
  const o = await get("SELECT * FROM task_orders WHERE id = ?", [req.params.id]);
  if (!o) throw taskService.httpError(404, "Order not found");
  if (o.status !== "AWAITING_CONFIRMATION") throw taskService.httpError(400, "This order is not waiting for confirmation");
  await run("UPDATE task_orders SET status = 'PENDING_PAYMENT', payment_reference = NULL, updated_at = ? WHERE id = ?", [nowIso(), o.id]);
  await notificationService.notify(o.advertiser_id, { icon: "alert", title: "Payment not found", body: "We could not confirm your payment. Please check the transaction ID and send it again." });
  res.json({ ok: true });
}));

module.exports = router;
