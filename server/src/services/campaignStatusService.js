const { get, all, run, nowIso } = require("../db");
const { newId } = require("../utils/ids");

/**
 * The only allowed status transitions. Any change not listed here is
 * rejected — this is what makes "only authorized backend actions can change
 * campaign status" actually true rather than just a comment.
 */
const ALLOWED_TRANSITIONS = {
  DRAFT: ["PENDING_PAYMENT", "CANCELLED"],
  PENDING_PAYMENT: ["FUNDED", "CANCELLED"],
  FUNDED: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["SUBMITTED", "COMPLETED", "CANCELLED", "DISPUTED", "PUBLISHED"],
  SUBMITTED: ["UNDER_REVIEW", "IN_PROGRESS", "COMPLETED", "PUBLISHED", "CANCELLED", "DISPUTED"],
  UNDER_REVIEW: ["IN_PROGRESS", "COMPLETED", "DISPUTED"],
  DISPUTED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/** Moves a campaign to a new status, recording the transition. Throws if the transition isn't allowed. */
async function transitionCampaign(campaignId, toStatus, { actorId, note } = {}) {
  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [campaignId]);
  if (!campaign) { const e = new Error("Campaign not found"); e.status = 404; throw e; }
  if (campaign.status === toStatus) return campaign; // no-op, not an error

  if (!canTransition(campaign.status, toStatus)) {
    const e = new Error(`Cannot move campaign from ${campaign.status} to ${toStatus}`);
    e.status = 400;
    throw e;
  }

  const ts = nowIso();
  const extraCols = {
    FUNDED: "funded_at",
    PUBLISHED: "published_at",
    COMPLETED: "completed_at",
  };
  const col = extraCols[toStatus];
  if (col) {
    await run(`UPDATE campaigns SET status = ?, ${col} = ?, updated_at = ? WHERE id = ?`, [toStatus, ts, ts, campaignId]);
  } else {
    await run(`UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?`, [toStatus, ts, campaignId]);
  }

  await run(
    `INSERT INTO campaign_status_history (id, campaign_id, from_status, to_status, changed_by_user_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId("csh"), campaignId, campaign.status, toStatus, actorId || null, note || null, ts]
  );

  return get("SELECT * FROM campaigns WHERE id = ?", [campaignId]);
}

async function getHistory(campaignId) {
  return all("SELECT * FROM campaign_status_history WHERE campaign_id = ? ORDER BY created_at ASC", [campaignId]);
}

module.exports = { transitionCampaign, canTransition, getHistory, ALLOWED_TRANSITIONS };
