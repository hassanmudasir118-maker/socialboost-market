const { get, run, lockRow, nowIso, transaction } = require("../db");

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function getOrCreate(campaignId) {
  let row = await get("SELECT * FROM campaign_escrow WHERE campaign_id = ?", [campaignId]);
  if (row) return row;
  await run(
    "INSERT INTO campaign_escrow (campaign_id, funded_cents, reserved_cents, released_cents, refunded_cents, updated_at) VALUES (?, 0, 0, 0, 0, ?) ON CONFLICT (campaign_id) DO NOTHING",
    [campaignId, nowIso()]
  );
  return get("SELECT * FROM campaign_escrow WHERE campaign_id = ?", [campaignId]);
}

/**
 * Locks the escrow row for the remainder of the enclosing transaction, then
 * returns the freshly-read row. Every write path below calls this (instead
 * of the plain getOrCreate read) immediately before checking a balance and
 * writing, so two concurrent reserve()/release()/refund() calls against the
 * same campaign can never both read the same "available" figure and both
 * proceed — the second waits for the first's transaction to commit or roll
 * back before it can even read the row. Must be called from inside
 * db.transaction(); every caller in this codebase already does that
 * (paymentService / paymentGatewayService / withdrawalService).
 */
async function getOrCreateForUpdate(campaignId) {
  await getOrCreate(campaignId); // ensure the row exists before attempting to lock it
  return lockRow("campaign_escrow", "campaign_id", campaignId);
}

/** Available = funded, minus everything already committed, paid out, or refunded. Never negative by construction. */
function available(row) {
  return row.funded_cents - row.reserved_cents - row.released_cents - row.refunded_cents;
}

async function fund(campaignId, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw httpError(400, "Invalid fund amount");
  return transaction(async () => {
    await getOrCreateForUpdate(campaignId);
    await run("UPDATE campaign_escrow SET funded_cents = funded_cents + ?, updated_at = ? WHERE campaign_id = ?", [amountCents, nowIso(), campaignId]);
    return get("SELECT * FROM campaign_escrow WHERE campaign_id = ?", [campaignId]);
  });
}

/** Reserves an amount for a specific creator allocation. Throws if it would exceed available escrow — the core "never allocate above funded" guard from §6. */
async function reserve(campaignId, amountCents) {
  return transaction(async () => {
    const row = await getOrCreateForUpdate(campaignId);
    if (available(row) < amountCents) {
      throw httpError(400, `Insufficient escrow: available $${(available(row) / 100).toFixed(2)}, requested $${(amountCents / 100).toFixed(2)}`);
    }
    await run("UPDATE campaign_escrow SET reserved_cents = reserved_cents + ?, updated_at = ? WHERE campaign_id = ?", [amountCents, nowIso(), campaignId]);
    return get("SELECT * FROM campaign_escrow WHERE campaign_id = ?", [campaignId]);
  });
}

/** Moves a reserved amount to released (actual payout). Throws if the campaign doesn't have that much reserved — prevents releasing/double-releasing more than was ever reserved. */
async function release(campaignId, amountCents) {
  return transaction(async () => {
    const row = await getOrCreateForUpdate(campaignId);
    if (row.reserved_cents < amountCents) throw httpError(400, "Cannot release more than is reserved — possible double-release attempt");
    await run(
      "UPDATE campaign_escrow SET reserved_cents = reserved_cents - ?, released_cents = released_cents + ?, updated_at = ? WHERE campaign_id = ?",
      [amountCents, amountCents, nowIso(), campaignId]
    );
    return get("SELECT * FROM campaign_escrow WHERE campaign_id = ?", [campaignId]);
  });
}

/** Frees a reservation without paying it out (assignment cancelled/rejected before submission was approved). */
async function cancelReservation(campaignId, amountCents) {
  return transaction(async () => {
    const row = await getOrCreateForUpdate(campaignId);
    if (row.reserved_cents < amountCents) throw httpError(400, "Cannot cancel more reservation than exists");
    await run("UPDATE campaign_escrow SET reserved_cents = reserved_cents - ?, updated_at = ? WHERE campaign_id = ?", [amountCents, nowIso(), campaignId]);
    return get("SELECT * FROM campaign_escrow WHERE campaign_id = ?", [campaignId]);
  });
}

/** Refunds from the UNRESERVED pool only — money already reserved or released can never be silently refunded out from under a creator. */
async function refund(campaignId, amountCents) {
  return transaction(async () => {
    const row = await getOrCreateForUpdate(campaignId);
    if (available(row) < amountCents) throw httpError(400, "Cannot refund more than the unreserved, available escrow");
    await run("UPDATE campaign_escrow SET refunded_cents = refunded_cents + ?, updated_at = ? WHERE campaign_id = ?", [amountCents, nowIso(), campaignId]);
    return get("SELECT * FROM campaign_escrow WHERE campaign_id = ?", [campaignId]);
  });
}

async function summary(campaignId) {
  const row = await getOrCreate(campaignId);
  return {
    funded: row.funded_cents / 100,
    reserved: row.reserved_cents / 100,
    released: row.released_cents / 100,
    refunded: row.refunded_cents / 100,
    available: available(row) / 100,
  };
}

module.exports = { getOrCreate, available, fund, reserve, release, cancelReservation, refund, summary, httpError };
