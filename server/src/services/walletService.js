const { get, all, run, lockRow, nowIso, transaction } = require("../db");
const { newId } = require("../utils/ids");

/** Ensures a wallet row exists for a user; returns it. Called lazily on first need. */
async function getOrCreateWallet(userId) {
  let wallet = await get("SELECT * FROM wallets WHERE user_id = ?", [userId]);
  if (wallet) return wallet;
  const id = newId("wal");
  const ts = nowIso();
  await run(
    `INSERT INTO wallets (id, user_id, balance_cents, pending_cents, total_earned_cents, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, ?, ?)
     ON CONFLICT (user_id) DO NOTHING`,
    [id, userId, ts, ts]
  );
  return get("SELECT * FROM wallets WHERE user_id = ?", [userId]);
}

/**
 * Locks the wallet row for the remainder of the enclosing transaction, then
 * returns the freshly-read row — required before credit()/debit() compute a
 * new balance, so two concurrent operations on the same wallet (e.g. a
 * payout landing at the same moment as a withdrawal request) can't both read
 * the same starting balance. Must be called from inside db.transaction().
 */
async function getWalletForUpdate(userId) {
  await getOrCreateWallet(userId); // ensure the row exists before attempting to lock it
  return lockRow("wallets", "user_id", userId);
}

/**
 * Credits a user's wallet by amountCents, appends an immutable ledger row, and
 * updates the materialized wallet balance — all in one call. This is the ONLY
 * function in the codebase allowed to increase a wallet balance. Never call
 * this with a client-supplied amount; amountCents must always be computed
 * server-side (see paymentService).
 */
async function credit(userId, amountCents, reason, reference) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("credit() requires a positive integer amountCents");
  }
  return transaction(async () => {
    const wallet = await getWalletForUpdate(userId);
    const newBalance = wallet.balance_cents + amountCents;
    const ts = nowIso();

    await run(
      `UPDATE wallets SET balance_cents = ?, total_earned_cents = total_earned_cents + ?, updated_at = ? WHERE id = ?`,
      [newBalance, amountCents, ts, wallet.id]
    );

    await run(
      `INSERT INTO wallet_ledger (id, wallet_id, direction, reason, amount_cents, balance_after_cents, reference_type, reference_id, created_at)
       VALUES (?, ?, 'CREDIT', ?, ?, ?, ?, ?, ?)`,
      [newId("ldg"), wallet.id, reason, amountCents, newBalance, reference?.type || null, reference?.id || null, ts]
    );

    return get("SELECT * FROM wallets WHERE id = ?", [wallet.id]);
  });
}

/**
 * Debits a user's wallet. Throws if the wallet doesn't have sufficient balance —
 * this is the server-side guard that makes an over-withdrawal impossible
 * regardless of what the client requests.
 */
async function debit(userId, amountCents, reason, reference) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("debit() requires a positive integer amountCents");
  }
  return transaction(async () => {
    const wallet = await getWalletForUpdate(userId);
    if (wallet.balance_cents < amountCents) {
      const err = new Error("Insufficient wallet balance");
      err.status = 400;
      throw err;
    }
    const newBalance = wallet.balance_cents - amountCents;
    const ts = nowIso();

    await run(`UPDATE wallets SET balance_cents = ?, updated_at = ? WHERE id = ?`, [newBalance, ts, wallet.id]);

    await run(
      `INSERT INTO wallet_ledger (id, wallet_id, direction, reason, amount_cents, balance_after_cents, reference_type, reference_id, created_at)
       VALUES (?, ?, 'DEBIT', ?, ?, ?, ?, ?, ?)`,
      [newId("ldg"), wallet.id, reason, amountCents, newBalance, reference?.type || null, reference?.id || null, ts]
    );

    return get("SELECT * FROM wallets WHERE id = ?", [wallet.id]);
  });
}

async function getWallet(userId) {
  return getOrCreateWallet(userId);
}

async function getLedger(userId, limit = 50) {
  const wallet = await getOrCreateWallet(userId);
  return all("SELECT * FROM wallet_ledger WHERE wallet_id = ? ORDER BY created_at DESC LIMIT ?", [wallet.id, limit]);
}

module.exports = { getOrCreateWallet, credit, debit, getWallet, getLedger };
