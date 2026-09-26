// Instagram — "Instagram API with Instagram Login" (Business Login for
// Instagram). Meta shut down the old Instagram Basic Display API on
// 2024-12-04 — it no longer works for any account. This adapter targets its
// replacement, which does NOT require linking a Facebook Page (unlike the
// older "Facebook Login for Business" route to Instagram) but DOES require
// the user's Instagram account to be a Creator or Business account, not a
// personal one — there is no API access to personal Instagram accounts
// anymore, by any path.
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
//       https://developers.facebook.com/docs/instagram-platform/reference/access_token
//
// NOT executed against the real endpoints in this environment (no network
// access, no real app credentials) — implemented and reviewed against
// Meta's current published docs (checked while writing this), not verified
// end-to-end. Endpoint paths on Meta's side have changed more than once in
// the last two years — re-verify against current docs before going live.

const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_URL = "https://api.instagram.com/oauth/access_token"; // short-lived token exchange
const GRAPH_BASE = "https://graph.instagram.com"; // long-lived token exchange, refresh, and all profile/metrics calls
const SCOPE = "instagram_business_basic";

function isConfigured() {
  return !!(process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET && process.env.INSTAGRAM_REDIRECT_URI);
}

function getAuthorizationUrl({ state }) {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_CLIENT_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function handleCallback({ code }) {
  // Step 1: exchange the authorization code for a SHORT-lived token (1 hour).
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_CLIENT_ID,
    client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
    grant_type: "authorization_code",
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    code,
  });
  const shortRes = await fetch(TOKEN_URL, { method: "POST", body: form });
  if (!shortRes.ok) throw new Error(`Instagram token exchange failed (${shortRes.status})`);
  const shortData = await shortRes.json();

  // Step 2: immediately exchange it for a LONG-lived token (60 days) — this
  // is the token we actually store; the short-lived one is discarded.
  const longParams = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
    access_token: shortData.access_token,
  });
  const longRes = await fetch(`${GRAPH_BASE}/access_token?${longParams.toString()}`);
  if (!longRes.ok) throw new Error(`Instagram long-lived token exchange failed (${longRes.status})`);
  const longData = await longRes.json();

  return {
    accessToken: longData.access_token,
    // Instagram has no separate refresh token — the SAME long-lived access
    // token is what gets refreshed in place (see refreshToken() below). We
    // store it in both fields so the generic "has a refresh token" check
    // elsewhere in the app behaves correctly for this platform.
    refreshToken: longData.access_token,
    expiresInSeconds: longData.expires_in || 60 * 24 * 60 * 60, // Meta docs: 60 days
    scopes: [SCOPE],
  };
}

async function getProfile({ accessToken }) {
  const params = new URLSearchParams({ fields: "id,username,account_type,profile_picture_url", access_token: accessToken });
  const res = await fetch(`${GRAPH_BASE}/me?${params.toString()}`);
  if (!res.ok) throw new Error(`Instagram profile fetch failed (${res.status})`);
  const data = await res.json();
  if (data.account_type === "PERSONAL") {
    // Should be unreachable in practice (Instagram no longer issues these
    // scopes to personal accounts), but fail loudly rather than silently
    // treating a personal account as verified if Meta's behavior ever changes.
    throw new Error("Instagram Login requires a Creator or Business account — this is a personal account");
  }
  return {
    platformUserId: data.id,
    username: data.username || null,
    displayName: data.username || null, // the Instagram Login API does not expose a separate display name
    profileUrl: data.username ? `https://instagram.com/${data.username}` : null,
    profileImageUrl: data.profile_picture_url || null,
  };
}

async function getMetrics({ accessToken }) {
  // followers_count/follows_count are only populated for Creator/Business
  // accounts and may require additional permissions Meta hasn't granted this
  // app yet — request them, but tolerate their absence rather than failing,
  // per §7 ("do not invent unavailable metrics").
  const params = new URLSearchParams({ fields: "followers_count,follows_count,media_count", access_token: accessToken });
  const res = await fetch(`${GRAPH_BASE}/me?${params.toString()}`);
  if (!res.ok) throw new Error(`Instagram metrics fetch failed (${res.status})`);
  const data = await res.json();
  return {
    followerCount: data.followers_count != null ? Number(data.followers_count) : null,
    followingCount: data.follows_count != null ? Number(data.follows_count) : null,
    mediaCount: data.media_count != null ? Number(data.media_count) : null,
    // No aggregate engagement-rate field is exposed by this API surface.
    engagementMetrics: null,
  };
}

/**
 * Instagram doesn't issue a distinct refresh token — the long-lived access
 * token itself gets refreshed in place, and only once it's at least 24 hours
 * old (a refresh attempted sooner will fail). `refreshToken` here is the
 * same value as the stored access token (see handleCallback above).
 */
async function refreshToken({ refreshToken: token }) {
  const params = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  const res = await fetch(`${GRAPH_BASE}/refresh_access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Instagram token refresh failed (${res.status}) — the token may be under 24 hours old or already expired`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.access_token, // same value, kept in both fields — see note above
    expiresInSeconds: data.expires_in || 60 * 24 * 60 * 60,
  };
}

/**
 * Meta does not expose a simple server-initiated "revoke this token" call
 * for this flow — a user revokes access from their own Instagram settings,
 * which arrives at our app as a deauthorization webhook (not implemented
 * here). This always returns false; local token deletion in
 * socialAccountService.disconnect() still happens regardless (see its
 * comments) so the connection is fully removed on our side either way.
 */
async function revoke() {
  return false;
}

module.exports = { name: "INSTAGRAM", isConfigured, getAuthorizationUrl, handleCallback, getProfile, getMetrics, refreshToken, revoke };
