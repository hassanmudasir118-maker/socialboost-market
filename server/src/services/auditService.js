const { all, run, nowIso } = require("../db");
const { newId } = require("../utils/ids");

/**
 * Every privileged or money-moving action calls this. It records who (actor
 * id + role, taken from the authenticated request — never from the request
 * body), what action, and on which entity, so any change to money, roles, or
 * campaign status is independently reconstructable later.
 */
async function log({ actorId, actorRole, action, targetType, targetId, campaignId, details }) {
  await run(
    `INSERT INTO admin_audit_logs (id, actor_id, actor_role, action, target_type, target_id, campaign_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("log"), actorId || null, actorRole || null, action, targetType || null, targetId || null, campaignId || null, details || null, nowIso()]
  );
}

async function list(limit = 200) {
  return all(
    `SELECT al.*, u.email as actor_email FROM admin_audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     ORDER BY al.created_at DESC LIMIT ?`,
    [limit]
  );
}

module.exports = { log, list };
