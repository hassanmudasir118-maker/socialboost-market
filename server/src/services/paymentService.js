const { get, run, transaction, nowIso } = require("../db");
const { newId } = require("../utils/ids");
const { applyBps } = require("../utils/money");
const wallet = require("./walletService");
const escrowService = require("./escrowService");
const statusService = require("./campaignStatusService");
const { getProvider } = require("./paymentProvider");

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** FUNDED -> PUBLISHED: makes the campaign visible in the public marketplace. */
async function publishCampaign({ campaignId, advertiserId }) {
  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [campaignId]);
  if (!campaign) throw httpError(404, "Campaign not found");
  if (campaign.advertiser_id !== advertiserId) throw httpError(403, "Not your campaign");
  return statusService.transitionCampaign(campaignId, "PUBLISHED", { actorId: advertiserId, note: "Published to marketplace" });
}

/**
 * Reserves a creator's agreed rate against the campaign's funded escrow.
 * Throws if the campaign doesn't have enough UNRESERVED escrow — this is
 * what makes "never allocate more than what's funded" actually enforced
 * (§6), not just a comment. Called when an advertiser accepts an application.
 * escrowService.reserve is itself transactional and row-locked, so this is
 * safe to call directly even when the caller isn't already inside a
 * transaction.
 */
async function reserveForAssignment(campaignId, amountCents) {
  return escrowService.reserve(campaignId, amountCents);
}

/** Frees a reservation without paying it out (assignment cancelled/rejected pre-approval). */
async function cancelAssignmentReservation(campaignId, amountCents) {
  return escrowService.cancelReservation(campaignId, amountCents);
}

/**
 * Releases a reserved amount to a creator for one completed assignment.
 * Idempotency guard: refuses if a CREATOR_PAYOUT transaction already exists
 * for this assignment's application — makes a double-release structurally
 * impossible even if this were somehow called twice.
 */
async function releaseAssignmentPayment({ assignment, campaign }) {
  return transaction(async () => {
    const existingPayout = await get("SELECT id FROM transactions WHERE type='CREATOR_PAYOUT' AND application_id = ?", [assignment.application_id]);
    if (existingPayout) throw httpError(409, "This assignment has already been paid out");

    await escrowService.release(campaign.id, assignment.agreed_rate_cents); // throws if over-release attempted

    const feeCents = applyBps(assignment.agreed_rate_cents, campaign.commission_bps);
    const netCents = assignment.agreed_rate_cents - feeCents;
    const ts = nowIso();
    const txnId = newId("txn");

    await run(
      `INSERT INTO transactions (id, type, status, user_id, campaign_id, application_id, amount_cents, platform_fee_cents, net_cents, currency, created_at)
       VALUES (?, 'CREATOR_PAYOUT', 'COMPLETED', ?, ?, ?, ?, ?, ?, 'usd', ?)`,
      [txnId, assignment.creator_id, campaign.id, assignment.application_id, assignment.agreed_rate_cents, feeCents, netCents, ts]
    );

    await wallet.credit(assignment.creator_id, netCents, "CAMPAIGN_PAYOUT", { type: "Transaction", id: txnId });

    return { feeCents, netCents, transactionId: txnId };
  });
}

/**
 * Refunds an advertiser via the payment provider. Only ever pulls from the
 * campaign's UNRESERVED available escrow (escrowService.refund enforces
 * this) — money already reserved for or paid to a creator can never be
 * silently clawed back this way. Supports partial refunds.
 */
async function refundCampaignFunding({ campaignId, advertiserId, amountCentsOverride }) {
  return transaction(async () => {
    const successfulPayment = await get("SELECT * FROM payments WHERE campaign_id = ? AND status IN ('SUCCEEDED') ORDER BY created_at DESC", [campaignId]);
    const escrow = await escrowService.getOrCreate(campaignId);
    const amount = amountCentsOverride ?? escrowService.available(escrow);
    if (!amount || amount <= 0) throw httpError(400, "No refundable escrow available for this campaign");

    await escrowService.refund(campaignId, amount); // throws if it exceeds available

    const provider = getProvider();
    let providerRefund = { providerRefundId: null };
    if (successfulPayment) {
      providerRefund = await provider.createRefund({ providerPaymentId: successfulPayment.provider_payment_id, amountCents: amount });
      const newRefundedTotal = successfulPayment.refunded_cents + amount;
      const fullyRefunded = newRefundedTotal >= successfulPayment.amount_cents;
      await run(
        "UPDATE payments SET refunded_cents = ?, status = ?, updated_at = ? WHERE id = ?",
        [newRefundedTotal, fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED", nowIso(), successfulPayment.id]
      );
    }

    const ts = nowIso();
    const txnId = newId("txn");
    await run(
      `INSERT INTO transactions (id, type, status, user_id, campaign_id, payment_id, amount_cents, platform_fee_cents, net_cents, currency, created_at)
       VALUES (?, 'REFUND', 'COMPLETED', ?, ?, ?, ?, 0, ?, 'usd', ?)`,
      [txnId, advertiserId, campaignId, successfulPayment?.id || null, amount, amount, ts]
    );

    return { transactionId: txnId, amount, providerRefundId: providerRefund.providerRefundId };
  });
}

async function markFundingReleased(campaignId) {
  await run("UPDATE transactions SET status = 'RELEASED' WHERE campaign_id = ? AND type = 'CAMPAIGN_FUNDING' AND status = 'HELD_IN_ESCROW'", [campaignId]);
}

module.exports = {
  publishCampaign, reserveForAssignment, cancelAssignmentReservation,
  releaseAssignmentPayment, refundCampaignFunding, markFundingReleased, httpError,
};
