// ---------------------------------------------------------------------------
// Every adapter in this directory implements the same interface:
//
//   name                                          — e.g. "YOUTUBE"
//   isConfigured()                                — bool, no throw
//   getAuthorizationUrl({ state, redirectUri })   — string
//   handleCallback({ code, redirectUri })         — { accessToken, refreshToken, expiresInSeconds, scopes }
//   getProfile({ accessToken })                   — { platformUserId, username, displayName, profileUrl, profileImageUrl }
//   getMetrics({ accessToken })                   — { followerCount, followingCount, mediaCount, engagementMetrics }
//   refreshToken({ refreshToken })                — { accessToken, refreshToken, expiresInSeconds } or throws RefreshNotSupportedError/RefreshFailedError
//   revoke({ accessToken, refreshToken })         — boolean (best-effort; provider revocation, not just local deletion)
//
// This file — and only this file — is what routes/services import; nothing
// outside socialProviders/ ever builds a provider URL or parses a provider
// response directly (see §5 of the OAuth brief).
// ---------------------------------------------------------------------------

const youtube = require("./youtube");
const tiktok = require("./tiktok");
const instagram = require("./instagram");
const facebook = require("./facebook");
const { ConfigurationError, RefreshNotSupportedError, RefreshFailedError, ProviderApiError } = require("./errors");

const ADAPTERS = { YOUTUBE: youtube, TIKTOK: tiktok, INSTAGRAM: instagram, FACEBOOK: facebook };

function getAdapter(platform) {
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    const err = new Error(`Unsupported platform: ${platform}`);
    err.status = 400;
    throw err;
  }
  return adapter;
}

function requireConfigured(platform) {
  const adapter = getAdapter(platform);
  if (!adapter.isConfigured()) throw new ConfigurationError(platform);
  return adapter;
}

/**
 * Test-only seam: swaps an adapter for a fake one so tests can exercise the
 * full connect/callback/disconnect/sync/eligibility flow through
 * socialAccountService and the real routes without making any real network
 * call to Google/TikTok/Meta. NEVER called from production code — only from
 * test/socialAccounts.test.js. Restore with _restoreAdapter after each test.
 */
function _setAdapterForTesting(platform, fakeAdapter) {
  if (process.env.NODE_ENV === "production") throw new Error("_setAdapterForTesting must never be called in production");
  ADAPTERS[platform] = fakeAdapter;
}
function _restoreAdapter(platform, realAdapter) {
  ADAPTERS[platform] = realAdapter;
}

module.exports = {
  SUPPORTED_PLATFORMS: Object.keys(ADAPTERS),
  getAdapter,
  requireConfigured,
  ConfigurationError,
  RefreshNotSupportedError,
  RefreshFailedError,
  ProviderApiError,
  _setAdapterForTesting,
  _restoreAdapter,
};
