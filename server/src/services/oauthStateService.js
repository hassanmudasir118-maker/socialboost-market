const crypto = require("crypto");
const { get, run, nowIso, transaction } = require("../db");
const { newId } = require("../utils/ids");

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for a real OAuth consent flow, short enough to limit replay window

// ---------------------------------------------------------------------------
// Why identity comes from the state row, not a Bearer token, at callback time
// ---------------------------------------------------------------------------
// This app authenticates API calls with a JWT Bearer header (see
// middleware/auth.js) — there is no session cookie. An OAuth callback,
// though, is a plain top-level browser redirect from the provider (Google/
// TikTok/etc.) back to our server: the browser cannot attach an
// Authorization header to that navigation. So the callback route is
// necessarily unauthenticated in the requireAuth sense.
//
// Security instead comes entirely from the state value: issueState() is only
// ever called from the Bearer-authenticated "connect" route, so a state row
// can only exist for a user who was genuinely logged in at that moment. The
// state itself is 32 random bytes, stored only as a SHA-256 hash, single-use,
// expiring, and platform-scoped. That's what makes it safe to trust the
// state row's user_id as "who this callback is for" — an attacker cannot
// produce a valid state without first being authenticated as that user, and
// cannot replay or redirect someone else's completed flow (single-use +
// exact platform match). This is what closes CSRF, callback injection, and
// account-linking attacks (§4 of the OAuth brief) without needing cookies.
// ---------------------------------------------------------------------------

/**
 * Issues a one-time, user-bound state value for an OAuth "Connect" click.
 * Called only from an authenticated route (req.user.id is real).
 */
async function issueState({ userId, platform, redirectUri }) {
  const state = crypto.randomBytes(32).toString("base64url");
  const stateHash = crypto.createHash("sha256").update(state).digest("hex");
  const ts = nowIso();
  await run(
    `INSERT INTO oauth_states (id, state_hash, user_id, platform, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId("ost"), stateHash, userId, platform, redirectUri, new Date(Date.now() + STATE_TTL_MS).toISOString(), ts]
  );
  return state;
}

/**
 * Validates and single-use-consumes a state value returned on the callback.
 * Enforces, in order: exists, not already used (rejects state/code reuse),
 * not expired, and platform matches what it was issued for. On success,
 * returns the user_id it was issued for — the callback route uses THIS as
 * the identity to attach the connection to, never anything the request
 * itself claims. Marks the row used inside the same locked transaction so a
 * concurrent duplicate callback (e.g. the user double-clicking, or a replay)
 * cannot also pass validation on the same state.
 */
async function consumeState({ state, platform }) {
  if (!state) return { valid: false, reason: "Missing state parameter" };
  const stateHash = crypto.createHash("sha256").update(state).digest("hex");

  return transaction(async () => {
    const row = await get("SELECT * FROM oauth_states WHERE state_hash = ? FOR UPDATE", [stateHash]);
    if (!row) return { valid: false, reason: "Unrecognized OAuth state" };
    if (row.used_at) return { valid: false, reason: "This authorization link has already been used" };
    if (new Date(row.expires_at) < new Date()) return { valid: false, reason: "This authorization link has expired — please try connecting again" };
    if (row.platform !== platform) return { valid: false, reason: "Platform mismatch between the authorization request and callback" };

    await run("UPDATE oauth_states SET used_at = ? WHERE id = ?", [nowIso(), row.id]);
    return { valid: true, userId: row.user_id, redirectUri: row.redirect_uri };
  });
}

module.exports = { issueState, consumeState };
