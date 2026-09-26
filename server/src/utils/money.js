// All monetary values are handled as integer cents everywhere on the server.
// The client sends/receives dollars for display, but every calculation the
// server performs uses integer cents to avoid floating-point drift.

function dollarsToCents(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

function centsToDollars(cents) {
  return Math.round(Number(cents)) / 100;
}

/** basis points, e.g. 1500 = 15.00% */
function applyBps(amountCents, bps) {
  return Math.round((Number(amountCents) * Number(bps)) / 10000);
}

module.exports = { dollarsToCents, centsToDollars, applyBps };
