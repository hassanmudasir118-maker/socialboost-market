// YouTube — Google OAuth 2.0 + YouTube Data API v3.
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server
//       https://developers.google.com/youtube/v3/docs/channels/list
//
// Requires a Google Cloud project with the YouTube Data API v3 enabled and
// an OAuth 2.0 Web application client. Scope used below is read-only and
// only exposes the channel the authenticated user owns — never another
// user's channel.
//
// NOT executed against the real Google endpoints in this environment (no
// network access, no real client credentials) — implemented and reviewed
// against Google's published API contract, not verified end-to-end.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

function isConfigured() {
  return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REDIRECT_URI);
}

function getAuthorizationUrl({ state }) {
  const params = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID,
    redirect_uri: process.env.YOUTUBE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // required to receive a refresh_token
    prompt: "consent", // forces a refresh_token on every connect, not just the first
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function handleCallback({ code }) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      redirect_uri: process.env.YOUTUBE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`YouTube token exchange failed (${res.status})`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null, // absent if the user had already granted consent before and prompt=consent wasn't honored
    expiresInSeconds: data.expires_in,
    scopes: (data.scope || SCOPE).split(" "),
  };
}

async function getProfile({ accessToken }) {
  const res = await fetch(`${CHANNELS_URL}?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`YouTube profile fetch failed (${res.status})`);
  const data = await res.json();
  const channel = data.items && data.items[0];
  if (!channel) throw new Error("No YouTube channel found for this Google account");
  return {
    platformUserId: channel.id,
    username: channel.snippet?.customUrl || null,
    displayName: channel.snippet?.title || null,
    profileUrl: channel.snippet?.customUrl ? `https://youtube.com/${channel.snippet.customUrl}` : `https://youtube.com/channel/${channel.id}`,
    profileImageUrl: channel.snippet?.thumbnails?.default?.url || null,
  };
}

async function getMetrics({ accessToken }) {
  const res = await fetch(`${CHANNELS_URL}?part=statistics&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`YouTube metrics fetch failed (${res.status})`);
  const data = await res.json();
  const stats = data.items?.[0]?.statistics;
  if (!stats) return { followerCount: null, followingCount: null, mediaCount: null, engagementMetrics: null };
  return {
    // YouTube hides subscriber count if the channel owner has chosen to; the
    // API returns hiddenSubscriberCount:true in that case — surface null
    // rather than a wrong number.
    followerCount: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0),
    followingCount: null, // channels don't have a "following" concept the API exposes here
    mediaCount: stats.videoCount != null ? Number(stats.videoCount) : null,
    // YouTube Data API v3 does not provide an aggregate engagement-rate
    // metric on this endpoint — do not invent one.
    engagementMetrics: { viewCount: stats.viewCount != null ? Number(stats.viewCount) : null },
  };
}

async function refreshToken({ refreshToken: token }) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: token,
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`YouTube token refresh failed (${res.status})`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token, // Google usually does not rotate the refresh token
    expiresInSeconds: data.expires_in,
  };
}

async function revoke({ accessToken, refreshToken: token }) {
  try {
    const res = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token || accessToken)}`, { method: "POST" });
    return res.ok;
  } catch (_) {
    return false; // best-effort — local disconnect proceeds regardless (see socialAccountService.disconnect)
  }
}

module.exports = { name: "YOUTUBE", isConfigured, getAuthorizationUrl, handleCallback, getProfile, getMetrics, refreshToken, revoke };
