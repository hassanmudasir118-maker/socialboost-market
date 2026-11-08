const { get, all, run, lockRow, nowIso, transaction } = require("../db");
const walletService = require("./walletService");
const notificationService = require("./notificationService");

const MIN_SECONDS_ON_TARGET = 15;   // creator must spend this long before "Done" is accepted
const AUTO_APPROVE_HOURS = 48;      // advertiser has this long to reject a claim
const MAX_CLAIMS_PER_DAY = 150;     // per creator

// Price the advertiser pays and reward the creator gets, per single action (in cents of Rs).
const RATES = {
  FOLLOW:    { price: 800,  reward: 500, label: "Follow" },
  SUBSCRIBE: { price: 1000, reward: 600, label: "Subscribe" },
  LIKE:      { price: 400,  reward: 250, label: "Like" },
};
const ACTIONS_BY_PLATFORM = {
  TIKTOK: ["FOLLOW", "LIKE"],
  INSTAGRAM: ["FOLLOW", "LIKE"],
  FACEBOOK: ["FOLLOW", "LIKE"],
  YOUTUBE: ["SUBSCRIBE", "LIKE"],
};
const HOSTS = {
  TIKTOK: ["tiktok.com"],
  INSTAGRAM: ["instagram.com"],
  FACEBOOK: ["facebook.com", "fb.com", "fb.watch"],
  YOUTUBE: ["youtube.com", "youtu.be"],
};

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Only links that really belong to the chosen platform are allowed, so a task can never send creators to some other website. */
function validateTargetUrl(platform, rawUrl) {
  let u;
  try { u = new URL(String(rawUrl).trim()); } catch { throw httpError(400, "Please paste a full link that starts with https://"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw httpError(400, "Please paste a full link that starts with https://");
  const host = u.hostname.toLowerCase().replace(/^(www|m|vm|vt)\./, "");
  const ok = (HOSTS[platform] || []).some((h) => host === h || host.endsWith("." + h));
  if (!ok) throw httpError(400, `This link is not a ${platform.charAt(0) + platform.slice(1).toLowerCase()} link`);
  return u.toString();
}

function slotsTaken(orderId) {
  return get("SELECT COUNT(*)::int AS n FROM task_claims WHERE order_id = ? AND status IN ('PENDING','APPROVED')", [orderId]).then((r) => r.n);
}

/** Approves a waiting claim and pays the creator. Safe to call twice. */
async function approveClaim(claimId, { auto = false } = {}) {
  return transaction(async () => {
    const claim = await lockRow("task_claims", "id", claimId);
    if (!claim || claim.status !== "PENDING") return false;
    const order = await lockRow("task_orders", "id", claim.order_id);
    const ts = nowIso();
    await run("UPDATE task_claims SET status = 'APPROVED', reward_cents = ?, resolved_at = ? WHERE id = ?", [order.reward_per_cents, ts, claim.id]);
    const done = order.done_count + 1;
    await run("UPDATE task_orders SET done_count = ?, status = ?, updated_at = ? WHERE id = ?", [done, done >= order.quantity ? "COMPLETED" : order.status, ts, order.id]);
    await walletService.credit(claim.creator_id, order.reward_per_cents, "TASK_REWARD", { type: "task_claim", id: claim.id });
    await notificationService.notify(claim.creator_id, {
      icon: "check", title: "Task approved",
      body: `Rs ${(order.reward_per_cents / 100).toFixed(2)} added to your wallet${auto ? "" : ""}.`,
    });
    return true;
  });
}

async function rejectClaim(claimId, reason) {
  return transaction(async () => {
    const claim = await lockRow("task_claims", "id", claimId);
    if (!claim || claim.status !== "PENDING") return false;
    await run("UPDATE task_claims SET status = 'REJECTED', resolved_at = ?, note = ? WHERE id = ?", [nowIso(), (reason || "").slice(0, 200) || null, claim.id]);
    await notificationService.notify(claim.creator_id, {
      icon: "alert", title: "Task not accepted",
      body: reason ? `The advertiser could not see your action: ${String(reason).slice(0, 120)}` : "The advertiser could not see your action.",
    });
    return true;
  });
}

/** Claims the advertiser did not reject within AUTO_APPROVE_HOURS are paid automatically. Called whenever task lists load. */
async function settleOverdueClaims() {
  const cutoff = new Date(Date.now() - AUTO_APPROVE_HOURS * 3600000).toISOString();
  const rows = await all("SELECT id FROM task_claims WHERE status = 'PENDING' AND claimed_at < ? ORDER BY claimed_at LIMIT 100", [cutoff]);
  for (const r of rows) {
    try { await approveClaim(r.id, { auto: true }); } catch (err) { console.warn("Auto-approve failed:", err.message); }
  }
}

module.exports = {
  RATES, ACTIONS_BY_PLATFORM, MIN_SECONDS_ON_TARGET, AUTO_APPROVE_HOURS, MAX_CLAIMS_PER_DAY,
  httpError, validateTargetUrl, slotsTaken, approveClaim, rejectClaim, settleOverdueClaims,
};
