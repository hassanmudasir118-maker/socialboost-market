const { get, all, run, nowIso } = require("../db");

const PLAN_DAYS = 30;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** The user's plan right now. An expired paid plan counts as FREE. */
async function getActivePlan(userId) {
  const user = await get("SELECT membership_plan, membership_expires_at FROM users WHERE id = ?", [userId]);
  let planId = user?.membership_plan || "FREE";
  const expiresAt = user?.membership_expires_at || null;
  if (planId !== "FREE" && (!expiresAt || new Date(expiresAt) < new Date())) planId = "FREE";
  const plan = await get("SELECT * FROM membership_plans WHERE id = ?", [planId]);
  return { plan: plan || { id: "FREE", name: "Free", price_cents: 0, commission_discount_bps: 0 }, expiresAt: planId === "FREE" ? null : expiresAt };
}

/** Commission discount (in basis points) this advertiser has earned. */
async function getDiscountBps(userId) {
  // If the membership tables are not set up yet (migration not run), payments
  // must keep working at the normal commission rather than fail.
  try {
    const { plan } = await getActivePlan(userId);
    return plan.commission_discount_bps || 0;
  } catch (err) {
    console.warn("Membership lookup skipped:", err.message);
    return 0;
  }
}

async function listPlans() {
  return all("SELECT * FROM membership_plans ORDER BY sort_order");
}

/** Gives a user a plan for PLAN_DAYS days (admin action after payment was received). */
async function grantPlan(userId, planId) {
  const plan = await get("SELECT * FROM membership_plans WHERE id = ?", [planId]);
  if (!plan) throw httpError(400, "Unknown plan");
  const user = await get("SELECT id, role FROM users WHERE id = ?", [userId]);
  if (!user) throw httpError(404, "User not found");
  if (user.role !== "ADVERTISER") throw httpError(400, "Memberships are for advertiser accounts");
  const expiresAt = planId === "FREE" ? null : new Date(Date.now() + PLAN_DAYS * 86400000).toISOString();
  await run("UPDATE users SET membership_plan = ?, membership_expires_at = ?, updated_at = ? WHERE id = ?", [planId, expiresAt, nowIso(), userId]);
  return { plan, expiresAt };
}

module.exports = { PLAN_DAYS, getActivePlan, getDiscountBps, listPlans, grantPlan };
