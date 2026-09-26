// TikTok — Login Kit v2 OAuth + Display API.
// Docs: https://developers.tiktok.com/doc/login-kit-web
//       https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
//
// TikTok calls its client id "client_key", not "client_id" — kept as-is
// below to match their API exactly rather than normalizing it, since a typo
// here is a silent auth failure.
//
// user.info.stats (follower_count etc.) requires TikTok app review beyond
// basic Login Kit approval — until that's granted, getMetrics() below will
// legitimately return nulls for fields TikTok didn't include in the
// response, per §7 ("do not invent unavailable metrics").
//
// NOT executed against the real TikTok endpoints in this environment (no
// network access, no real client credentials).

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
const SCOPE = "user.info.basic,user.info.stats";

function isConfigured() {
  return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REDIRECT_URI);
}

function getAuthorizationUrl({ state }) {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function handleCallback({ code }) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`TikTok token exchange failed (${res.status})`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresInSeconds: data.expires_in,
    scopes: (data.scope || SCOPE).split(","),
  };
}

async function getProfile({ accessToken }) {
  const fields = "open_id,username,display_name,avatar_url,profile_deep_link";
  const res = await fetch(`${USER_INFO_URL}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`TikTok profile fetch failed (${res.status})`);
  const data = await res.json();
  const user = data.data?.user;
  if (!user) throw new Error("TikTok did not return a user profile");
  return {
    platformUserId: user.open_id,
    username: user.username || null,
    displayName: user.display_name || null,
    profileUrl: user.profile_deep_link || (user.username ? `https://www.tiktok.com/@${user.username}` : null),
    profileImageUrl: user.avatar_url || null,
  };
}

async function getMetrics({ accessToken }) {
  const fields = "follower_count,following_count,likes_count,video_count";
  const res = await fetch(`${USER_INFO_URL}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`TikTok metrics fetch failed (${res.status})`);
  const data = await res.json();
  const user = data.data?.user || {};
  return {
    followerCount: user.follower_count != null ? Number(user.follower_count) : null,
    followingCount: user.following_count != null ? Number(user.following_count) : null,
    mediaCount: user.video_count != null ? Number(user.video_count) : null,
    engagementMetrics: user.likes_count != null ? { totalLikes: Number(user.likes_count) } : null,
  };
}

async function refreshToken({ refreshToken: token }) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: token,
    }),
  });
  if (!res.ok) throw new Error(`TikTok token refresh failed (${res.status})`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token,
    expiresInSeconds: data.expires_in,
  };
}

async function revoke({ accessToken }) {
  try {
    const res = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        token: accessToken,
      }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

module.exports = { name: "TIKTOK", isConfigured, getAuthorizationUrl, handleCallback, getProfile, getMetrics, refreshToken, revoke };
