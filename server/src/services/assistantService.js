const { all, get } = require("../db");

// The "assistant" does NOT move money or approve anything. It collects every
// item that needs a human decision, runs simple safety checks on each, and
// shows the admin a short warning list. Everything is computed on our own
// server, so no customer data is sent to any outside AI service.

const LARGE_PAYMENT_CENTS = 500000;   // Rs 5,000
const LARGE_PAYOUT_CENTS = 500000;
const NEW_ACCOUNT_HOURS = 48;

const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000;
const flag = (level, text) => ({ level, text }); // level: high | medium | info

/** How many OTHER records use the same payment reference (transaction ID)? */
async function referenceUsedElsewhere(reference, ignore) {
  const ref = String(reference || "").trim().toLowerCase();
  if (ref.length < 3) return 0;
  const [a, b, c] = await Promise.all([
    all("SELECT id FROM payments WHERE LOWER(TRIM(manual_reference)) = ?", [ref]),
    all("SELECT id FROM membership_requests WHERE LOWER(TRIM(payment_reference)) = ?", [ref]),
    all("SELECT id FROM task_orders WHERE LOWER(TRIM(payment_reference)) = ?", [ref]),
  ]);
  return [...a, ...b, ...c].filter((r) => r.id !== ignore).length;
}

async function accountFlags(userId) {
  const flags = [];
  const u = await get("SELECT created_at, email_verified, suspended FROM users WHERE id = ?", [userId]);
  if (!u) return flags;
  if (u.suspended) flags.push(flag("high", "This account is suspended"));
  if (hoursSince(u.created_at) < NEW_ACCOUNT_HOURS) flags.push(flag("medium", "Account is less than 2 days old"));
  if (!u.email_verified) flags.push(flag("info", "Email is not verified"));
  return flags;
}

async function buildTodo() {
  const items = [];

  // 1. Campaign payments (EasyPaisa / JazzCash / bank)
  const payments = await all(
    `SELECT p.id, p.user_id, p.amount_cents, p.payment_method, p.manual_reference, p.updated_at, u.email, c.title
       FROM payments p JOIN users u ON u.id = p.user_id LEFT JOIN campaigns c ON c.id = p.campaign_id
      WHERE p.provider = 'manual' AND p.manual_review_status = 'PENDING_REVIEW' ORDER BY p.updated_at LIMIT 50`);
  for (const p of payments) {
    const flags = await accountFlags(p.user_id);
    if ((await referenceUsedElsewhere(p.manual_reference, p.id)) > 0) flags.unshift(flag("high", "This transaction ID was already used on another payment"));
    if (p.amount_cents >= LARGE_PAYMENT_CENTS) flags.push(flag("medium", "Large amount: check your EasyPaisa app carefully"));
    const earlier = await get("SELECT COUNT(*)::int AS n FROM payments WHERE user_id = ? AND manual_review_status = 'CONFIRMED'", [p.user_id]);
    if (earlier.n === 0) flags.push(flag("info", "First payment from this person"));
    items.push({ kind: "PAYMENT", tab: "Manual payments", title: `Campaign payment Rs ${p.amount_cents / 100}`, detail: `${p.email} · ${p.payment_method || "manual"} · ID: ${p.manual_reference || "-"}${p.title ? ` · ${p.title}` : ""}`, createdAt: p.updated_at, flags });
  }

  // 2. Follower / like orders
  const orders = await all(
    `SELECT o.*, u.email FROM task_orders o JOIN users u ON u.id = o.advertiser_id WHERE o.status = 'AWAITING_CONFIRMATION' ORDER BY o.updated_at LIMIT 50`);
  for (const o of orders) {
    const flags = await accountFlags(o.advertiser_id);
    if ((await referenceUsedElsewhere(o.payment_reference, o.id)) > 0) flags.unshift(flag("high", "This transaction ID was already used elsewhere"));
    if (o.total_cents >= LARGE_PAYMENT_CENTS) flags.push(flag("medium", "Large amount: check your EasyPaisa app carefully"));
    items.push({ kind: "TASK_ORDER", tab: "Follower orders", title: `${o.quantity} ${o.action.toLowerCase()} order, Rs ${o.total_cents / 100}`, detail: `${o.email} · ${o.payment_method || ""} · ID: ${o.payment_reference || "-"}`, createdAt: o.updated_at, flags });
  }

  // 3. Membership requests
  const members = await all(
    `SELECT r.*, u.email FROM membership_requests r JOIN users u ON u.id = r.user_id WHERE r.status = 'PENDING' ORDER BY r.created_at LIMIT 50`);
  for (const r of members) {
    const flags = await accountFlags(r.user_id);
    if ((await referenceUsedElsewhere(r.payment_reference, r.id)) > 0) flags.unshift(flag("high", "This transaction ID was already used elsewhere"));
    items.push({ kind: "MEMBERSHIP", tab: "Memberships", title: `${r.plan_id} membership request`, detail: `${r.email} · ID: ${r.payment_reference || "-"}`, createdAt: r.created_at, flags });
  }

  // 4. Creator withdrawals
  const withdrawals = await all(
    `SELECT w.*, u.email FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status = 'PENDING' ORDER BY w.requested_at LIMIT 50`);
  for (const w of withdrawals) {
    const flags = await accountFlags(w.user_id);
    if (w.payout_account_number) {
      const shared = await get("SELECT COUNT(DISTINCT user_id)::int AS n FROM withdrawals WHERE payout_account_number = ? AND user_id <> ?", [w.payout_account_number, w.user_id]);
      if (shared.n > 0) flags.unshift(flag("high", "The same payout number is used by another account"));
    } else {
      flags.push(flag("medium", "No payout account saved"));
    }
    if (w.amount_cents >= LARGE_PAYOUT_CENTS) flags.push(flag("medium", "Large withdrawal"));
    const earned = await get("SELECT total_earned_cents FROM wallets WHERE user_id = ?", [w.user_id]);
    if (earned && w.amount_cents > earned.total_earned_cents) flags.push(flag("high", "Asking for more than this account ever earned"));
    items.push({ kind: "WITHDRAWAL", tab: "Withdrawals", title: `Withdrawal Rs ${w.amount_cents / 100}`, detail: `${w.email} · ${w.payout_account_method || "?"} ${maskNumber(w.payout_account_number)}`, createdAt: w.requested_at, flags });
  }

  const rank = { high: 0, medium: 1, info: 2 };
  const worst = (it) => (it.flags.length ? Math.min(...it.flags.map((f) => rank[f.level])) : 3);
  items.sort((a, b) => worst(a) - worst(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
  return items.map((it) => ({ ...it, verdict: it.flags.some((f) => f.level === "high") ? "CHECK_CAREFULLY" : it.flags.some((f) => f.level === "medium") ? "LOOK_TWICE" : "LOOKS_NORMAL" }));
}

function maskNumber(n) {
  const s = String(n || "");
  return s.length > 4 ? `••••${s.slice(-4)}` : s;
}

/**
 * Sends a short alert to the admin's Telegram, if TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHAT_ID are set. Never throws and never blocks the request. The
 * message holds no names, numbers or emails, only what happened.
 */
function alertAdmin(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || typeof fetch !== "function") return;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: `SocialBoost: ${text}` }),
  }).catch(() => {});
}

module.exports = { buildTodo, alertAdmin };
