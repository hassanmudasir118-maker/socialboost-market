// Facebook — Facebook Login OAuth + Graph API.
// Docs: https://developers.facebook.com/docs/facebook-login/guides/access-tokens
//       https://developers.facebook.com/docs/graph-api/reference/user/accounts/
//
// A personal Facebook profile has no public follower/fan count exposed by
// the Graph API (privacy-protected) — only Facebook PAGES do. So this
// adapter authenticates the person, then operates on the first Page they
// manage (pages_show_list scope) as "the connected account". A creator with
// multiple Pages only gets the first one connected here; supporting a
// picker for multiple Pages is a real follow-up, not implemented in this
// pass.
//
// NOT executed against the real endpoints in this environment (no network
// access, no real app credentials).

const { RefreshNotSupportedError } = require("../errors");

const GRAPH_VERSION = "v19.0";
const AUTHORIZE_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const SCOPE = "public_profile,pages_show_list,pages_read_engagement";

function isConfigured() {
  return !!(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET && process.env.FACEBOOK_REDIRECT_URI);
}

function getAuthorizationUrl({ state }) {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_CLIENT_ID,
    redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function handleCallback({ code }) {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_CLIENT_ID,
    client_secret: process.env.FACEBOOK_CLIENT_SECRET,
    redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
    code,
  });
  const shortRes = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!shortRes.ok) throw new Error(`Facebook token exchange failed (${shortRes.status})`);
  const shortData = await shortRes.json();

  // Exchange for a long-lived token (~60 days) immediately, same pattern as Instagram.
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.FACEBOOK_CLIENT_ID,
    client_secret: process.env.FACEBOOK_CLIENT_SECRET,
    fb_exchange_token: shortData.access_token,
  });
  const longRes = await fetch(`${GRAPH_BASE}/oauth/access_token?${longParams.toString()}`);
  if (!longRes.ok) throw new Error(`Facebook long-lived token exchange failed (${longRes.status})`);
  const longData = await longRes.json();

  return {
    accessToken: longData.access_token,
    // Facebook user access tokens have no refresh-token grant — a long-lived
    // token must be re-obtained via a fresh login before/after it expires
    // (see refreshToken() below, which reflects this honestly).
    refreshToken: null,
    expiresInSeconds: longData.expires_in || 60 * 24 * 60 * 60,
    scopes: SCOPE.split(","),
  };
}

async function getManagedPage(accessToken) {
  const params = new URLSearchParams({ fields: "id,name,link,fan_count,picture,access_token", access_token: accessToken });
  const res = await fetch(`${GRAPH_BASE}/me/accounts?${params.toString()}`);
  if (!res.ok) throw new Error(`Facebook Pages fetch failed (${res.status})`);
  const data = await res.json();
  const page = data.data?.[0];
  if (!page) throw new Error("No Facebook Page found — connect an account that manages at least one Facebook Page");
  return page;
}

async function getProfile({ accessToken }) {
  const page = await getManagedPage(accessToken);
  return {
    platformUserId: page.id,
    username: null, // Pages don't have a separate @username the Graph API exposes here
    displayName: page.name || null,
    profileUrl: page.link || `https://facebook.com/${page.id}`,
    profileImageUrl: page.picture?.data?.url || null,
  };
}

async function getMetrics({ accessToken }) {
  const page = await getManagedPage(accessToken);
  return {
    followerCount: page.fan_count != null ? Number(page.fan_count) : null,
    followingCount: null, // not a concept that applies to Pages
    mediaCount: null, // would require the Page's posts/videos endpoints with pages_read_engagement — not fetched here
    engagementMetrics: null,
  };
}

/**
 * Facebook does not support silently refreshing a user access token — the
 * user must go through the login dialog again. Marking the connection
 * EXPIRED and prompting reconnect (handled by socialAccountService) is the
 * correct behavior here, not a retry loop.
 */
async function refreshToken() {
  throw new RefreshNotSupportedError("FACEBOOK");
}

async function revoke({ accessToken }) {
  try {
    const params = new URLSearchParams({ access_token: accessToken });
    const res = await fetch(`${GRAPH_BASE}/me/permissions?${params.toString()}`, { method: "DELETE" });
    return res.ok;
  } catch (_) {
    return false;
  }
}

module.exports = { name: "FACEBOOK", isConfigured, getAuthorizationUrl, handleCallback, getProfile, getMetrics, refreshToken, revoke };
