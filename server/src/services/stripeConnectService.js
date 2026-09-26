const { get, run, nowIso } = require("../db");
const auditService = require("./auditService");
const notificationService = require("./notificationService");

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function stripe() {
  if ((process.env.PAYMENT_PROVIDER || "mock") !== "stripe") {
    throw httpError(503, "Payouts setup requires the Stripe payment provider to be configured on this server.");
  }
  return require("./paymentProvider/stripeProvider");
}

/** Current onboarding state for a creator's wallet — used by the settings UI. */
async function getStatus(userId) {
  const wallet = await get("SELECT stripe_connected_account_id, stripe_payouts_enabled FROM wallets WHERE user_id = ?", [userId]);
  return {
    connected: !!wallet?.stripe_connected_account_id,
    payoutsEnabled: !!wallet?.stripe_payouts_enabled,
  };
}

/**
 * Starts (or resumes) Connect onboarding for a creator: creates their
 * Express account on first call, then always issues a fresh Account Link
 * (these expire after a few minutes, so a stored link is never reused).
 * Returns the URL the frontend should navigate the browser to — same
 * full-page-redirect pattern as the social OAuth connect flow, for the same
 * reason (this leaves the SPA to a Stripe-hosted page).
 */
async function beginOnboarding({ userId, email }) {
  const provider = stripe();
  const frontendBase = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";
  const returnUrl = `${frontendBase}/dashboard?tab=earnings&payouts=return`;
  const refreshUrl = `${frontendBase}/dashboard?tab=earnings&payouts=refresh`;

  let wallet = await get("SELECT * FROM wallets WHERE user_id = ?", [userId]);
  if (!wallet) throw httpError(404, "Wallet not found");

  let accountId = wallet.stripe_connected_account_id;
  if (!accountId) {
    const created = await provider.createConnectedAccount({ userId, email });
    accountId = created.accountId;
    await run("UPDATE wallets SET stripe_connected_account_id = ?, updated_at = ? WHERE user_id = ?", [accountId, nowIso(), userId]);
    await auditService.log({ actorId: userId, actorRole: null, action: "Stripe Connect account created", targetType: "Wallet", targetId: accountId });
  }

  const link = await provider.createAccountLink({ accountId, refreshUrl, returnUrl });
  return { url: link.url };
}

/**
 * Reacts to Stripe's `account.updated` webhook — the authoritative signal
 * that onboarding actually finished (never inferred from the user simply
 * being redirected back to return_url, which happens whether they completed
 * the form or abandoned it). Looks up the wallet by the connected account
 * id embedded in the event; if none matches, this account isn't one we
 * created (or the row was somehow cleared) and the event is a safe no-op.
 */
async function handleAccountUpdated(account) {
  const wallet = await get("SELECT * FROM wallets WHERE stripe_connected_account_id = ?", [account.id]);
  if (!wallet) return { ok: true, ignored: true };

  const payoutsEnabled = !!account.payouts_enabled;
  const wasEnabled = !!wallet.stripe_payouts_enabled;
  await run("UPDATE wallets SET stripe_payouts_enabled = ?, updated_at = ? WHERE id = ?", [payoutsEnabled ? 1 : 0, nowIso(), wallet.id]);

  if (payoutsEnabled && !wasEnabled) {
    await auditService.log({ actorId: wallet.user_id, actorRole: null, action: "Stripe Connect payouts enabled", targetType: "Wallet", targetId: account.id });
    await notificationService.notify(wallet.user_id, { icon: "success", title: "Payouts are ready", body: "Your payout account is fully set up — withdrawals can now be sent to your bank." });
  } else if (!payoutsEnabled && wasEnabled) {
    await auditService.log({ actorId: wallet.user_id, actorRole: null, action: "Stripe Connect payouts disabled", targetType: "Wallet", targetId: account.id });
    await notificationService.notify(wallet.user_id, { icon: "alert", title: "Payouts paused", body: "Stripe needs more information before it can pay you out again — check your payout settings." });
  }
  return { ok: true };
}

module.exports = { getStatus, beginOnboarding, handleAccountUpdated };
