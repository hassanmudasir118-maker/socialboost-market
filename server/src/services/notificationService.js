const { all, run, nowIso } = require("../db");
const { newId } = require("../utils/ids");

async function notify(userId, { icon, title, body }) {
  if (!userId) return null;
  const id = newId("ntf");
  await run(
    `INSERT INTO notifications (id, user_id, icon, title, body, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [id, userId, icon, title, body, nowIso()]
  );
  return id;
}

async function listForUser(userId, limit = 50) {
  return all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [userId, limit]);
}

async function markAllRead(userId) {
  await run("UPDATE notifications SET read = 1 WHERE user_id = ?", [userId]);
}

module.exports = { notify, listForUser, markAllRead };
