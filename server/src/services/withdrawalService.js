const { get, run, transaction, nowIso } = require("../db");
const { newId } = require("../utils/ids");
const { applyBps } = require("../utils/money");
const wallet = require("./walletService");
const settingsService = require("./settingsService");
const { getProvider } = require("./paymentProvider");
const { httpError } = require("./paymentService");

/** Creates a withdrawal request. Debits the wallet immediately (held pending
 * admin review) so the funds can't be double-spent while the request is open. */
async function requestWithdrawal({ userId, amountCents }) {
  return transaction(async () => {
    const settings = await settingsService.getSettings();
    if (amountCents < settings.min_withdrawal_cents) throw httpError(400, `Minimum withdrawal is ${settings.min_withdrawal_cents / 100}`);
    if (amountCents > settings.max_withdrawal_cents) throw httpError(400, `Maximum withdrawal is ${settings.max_withdrawal_cents / 100}`);
    const w = await wallet.getOrCreateWallet(userId);
    if (w.balance_cents < amountCents) throw httpError(400, "Amount exceeds available balance");

    const feeCents = applyBps(amountCents, settings.processing_fee_bps) + settings.processing_fee_fixed_cents;
    const netCents = amountCents - feeCents;
    const ts = nowIso();

    await wallet.debit(userId, amountCents, "WITHDRAWAL_REQUEST", { type: "Withdrawal", id: null });

    const txnId = newId("txn");
    await run(
      `INSERT INTO transactions (id, type, status, user_id, amount_cents, platform_fee_cents, net_cents, currency, created_at)
       VALUES (?, 'WITHDRAWAL', 'PENDING', ?, ?, ?, ?, 'usd', ?)`,
      [txnId, userId, amountCents, feeCents, netCents, ts]
    );

    const wdId = newId("wdr");
    await run(
      `INSERT INTO withdrawals (id, user_id, transaction_id, amount_cents, fee_cents, net_cents, status, payout_status, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'NOT_STARTED', ?)`,
      [wdId, userId, txnId, amountCents, feeCents, netCents, ts]
    );

    return {
      withdrawal: await get("SELECT * FROM withdrawals WHERE id = ?", [wdId]),
      transaction: await get("SELECT * FROM transactions WHERE id = ?", [txnId]),
    };
  });
}

/**
 * Admin-only. Approving does NOT mean "paid" (§11) — it only authorizes and
 * kicks off a payout attempt through the payout provider, which starts in
 * PROCESSING. A separate, provider-driven confirmation (webhook in
 * production; markPayoutCompleted/markPayoutFailed here in test mode) is
 * what actually marks money as delivered. Rejecting refunds the wallet.
 */
async function resolveWithdrawal({ withdrawalId, approve, adminId }) {
  return transaction(async () => {
    const w = await get("SELECT * FROM withdrawals WHERE id = ? FOR UPDATE", [withdrawalId]);
    if (!w) throw httpError(404, "Withdrawal not found");
    if (w.status !== "PENDING") throw httpError(400, "Withdrawal already resolved");
    const ts = nowIso();

    if (approve) {
      const provider = getProvider();
      const payout = await provider.createPayout({ amountCents: w.net_cents, currency: "usd", destination: w.user_id });
      await run(
        `UPDATE withdrawals SET status='APPROVED', decided_at=?, decided_by_user_id=?, payout_provider=?, payout_provider_id=?, payout_status='PROCESSING' WHERE id=?`,
        [ts, adminId, provider.name, payout.payoutProviderId, withdrawalId]
      );
      await run("UPDATE transactions SET status='PROCESSING' WHERE id=?", [w.transaction_id]);
    } else {
      await run("UPDATE withdrawals SET status='REJECTED', decided_at=?, decided_by_user_id=?, payout_status='FAILED' WHERE id=?", [ts, adminId, withdrawalId]);
      await run("UPDATE transactions SET status='REJECTED' WHERE id=?", [w.transaction_id]);
      await wallet.credit(w.user_id, w.amount_cents, "WITHDRAWAL_REJECTED_REFUND", { type: "Withdrawal", id: withdrawalId });
    }
    return get("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
  });
}

/** Marks an approved payout as actually completed (production: driven by a payout-provider webhook). Idempotent. */
async function markPayoutCompleted(withdrawalId) {
  return transaction(async () => {
    const w = await get("SELECT * FROM withdrawals WHERE id = ? FOR UPDATE", [withdrawalId]);
    if (!w) throw httpError(404, "Withdrawal not found");
    if (w.payout_status === "COMPLETED") return w; // idempotent no-op
    if (w.status !== "APPROVED") throw httpError(400, "Withdrawal must be approved before its payout can complete");
    await run("UPDATE withdrawals SET payout_status='COMPLETED' WHERE id=?", [withdrawalId]);
    await run("UPDATE transactions SET status='COMPLETED' WHERE id=?", [w.transaction_id]);
    return get("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
  });
}

/** Marks an approved payout as failed at the provider (e.g. bad bank details). Refunds the wallet and allows retry. */
async function markPayoutFailed(withdrawalId, reason) {
  return transaction(async () => {
    const w = await get("SELECT * FROM withdrawals WHERE id = ? FOR UPDATE", [withdrawalId]);
    if (!w) throw httpError(404, "Withdrawal not found");
    if (w.payout_status === "COMPLETED") throw httpError(400, "This payout already completed — cannot mark as failed");
    if (w.payout_status === "FAILED") return w; // idempotent no-op
    await run("UPDATE withdrawals SET payout_status='FAILED', payout_failure_reason=? WHERE id=?", [reason, withdrawalId]);
    await run("UPDATE transactions SET status='FAILED' WHERE id=?", [w.transaction_id]);
    await wallet.credit(w.user_id, w.amount_cents, "WITHDRAWAL_REJECTED_REFUND", { type: "Withdrawal", id: withdrawalId });
    return get("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
  });
}

/** Retries a failed payout: debits the wallet again and re-attempts via the provider. */
async function retryPayout(withdrawalId) {
  return transaction(async () => {
    const w = await get("SELECT * FROM withdrawals WHERE id = ? FOR UPDATE", [withdrawalId]);
    if (!w) throw httpError(404, "Withdrawal not found");
    if (w.payout_status !== "FAILED") throw httpError(400, "Only a failed payout can be retried");
    const wallet_ = await wallet.getOrCreateWallet(w.user_id);
    if (wallet_.balance_cents < w.amount_cents) throw httpError(400, "Insufficient balance to retry this payout");
    await wallet.debit(w.user_id, w.amount_cents, "WITHDRAWAL_REQUEST", { type: "Withdrawal", id: withdrawalId });
    const provider = getProvider();
    const payout = await provider.createPayout({ amountCents: w.net_cents, currency: "usd", destination: w.user_id });
    await run(
      "UPDATE withdrawals SET payout_status='PROCESSING', payout_provider_id=?, payout_retry_count = payout_retry_count + 1, payout_failure_reason=NULL WHERE id=?",
      [payout.payoutProviderId, withdrawalId]
    );
    await run("UPDATE transactions SET status='PROCESSING' WHERE id=?", [w.transaction_id]);
    return get("SELECT * FROM withdrawals WHERE id = ?", [withdrawalId]);
  });
}

module.exports = { requestWithdrawal, resolveWithdrawal, markPayoutCompleted, markPayoutFailed, retryPayout };
