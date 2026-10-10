const jwt = require("jsonwebtoken");
const { get, all, run, nowIso } = require("../db");
const { newId } = require("../utils/ids");
const { generateToken, hashToken } = require("../utils/tokens");

const REFRESH_TOKEN_DAYS = 30;
const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || "15m";

/** Short-lived access token — only ever carries the user id (see middleware/auth.js). */
function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

/** Creates a new revocable session (refresh token) and returns both tokens. */
async function createSession(userId, { userAgent, ip } = {}) {
  const { raw, hash } = generateToken();
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400000).toISOString();
  await run(
    `INSERT INTO user_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [newId("ses"), userId, hash, userAgent || null, ip || null, expiresAt, ts, ts]
  );

  return { accessToken: signAccessToken(userId), refreshToken: raw };
}

/** Exchanges a valid, unrevoked, unexpired refresh token for a new access token. Rotates the refresh token. */
async function refreshSession(rawRefreshToken, { userAgent, ip } = {}) {
  const hash = hashToken(rawRefreshToken);
  const session = await get("SELECT * FROM user_sessions WHERE refresh_token_hash = ?", [hash]);
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  // Rotate: revoke the old refresh token, issue a new one. Limits the damage
  // window if a refresh token is ever stolen (reuse becomes detectable).
  const ts = nowIso();
  await run("UPDATE user_sessions SET revoked_at = ? WHERE id = ?", [ts, session.id]);
  const next = await createSession(session.user_id, { userAgent, ip });
  return { ...next, userId: session.user_id };
}

async function revokeSession(rawRefreshToken) {
  const hash = hashToken(rawRefreshToken);
  await run("UPDATE user_sessions SET revoked_at = ? WHERE refresh_token_hash = ? AND revoked_at IS NULL", [nowIso(), hash]);
}

async function revokeAllSessions(userId) {
  await run("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [nowIso(), userId]);
}

/** Account activity history — shown to the user themselves and to admins. */
async function listActivity(userId, limit = 20) {
  return all(
    `SELECT id, user_agent, ip_address, created_at, last_used_at, revoked_at, expires_at
     FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
}

module.exports = { signAccessToken, createSession, refreshSession, revokeSession, revokeAllSessions, listActivity };
