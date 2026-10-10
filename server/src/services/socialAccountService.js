const { get, all, run, nowIso, transaction } = require("../db");
const { newId } = require("../utils/ids");
const { encrypt, decrypt } = require("../utils/crypto");
const { requireConfigured, getAdapter, RefreshNotSupportedError } = require("./socialProviders");
const oauthStateService = require("./oauthStateService");
const auditService = require("./auditService");
const notificationService = require("./notificationService");

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// A connection is treated as "needs refresh soon" this far ahead of its
// actual expiry, so a background sync/apply-time check can refresh it before
// it goes stale mid-request rather than only reacting after it's already expired.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Connect (step 1 of 2 — issues the authorization URL)
// ---------------------------------------------------------------------------
async function beginConnect({ userId, platform }) {
  const adapter = requireConfigured(platform); // throws ConfigurationError (503) if env vars aren't set — never pretends to connect
  const redirectUri = process.env[`${platform}_REDIRECT_URI`];
  const state = await oauthStateService.issueState({ userId, platform, redirectUri });
  return adapter.getAuthorizationUrl({ state, redirectUri });
}

// ---------------------------------------------------------------------------
// Callback (step 2 of 2 — exchanges the code, verifies identity, stores the connection)
// ---------------------------------------------------------------------------
/**
 * Handles the provider's redirect back to us. Returns { userId, platform,
 * status } on success (or throws) — callers (the route) use the returned
 * userId purely to build the redirect back to the frontend; it is NEVER
 * taken from anywhere except oauthStateService's validated state row (see
 * that file's comments on why there's no Bearer token available here).
 */
async function handleCallback({ platform, code, state, error: providerError }) {
  if (providerError) {
    // The user denied consent, or the provider itself errored — this is not
    // a security problem, just an unsuccessful connect attempt.
    throw httpError(400, `${platform} authorization was not completed: ${providerError}`);
  }

  const stateCheck = await oauthStateService.consumeState({ state, platform });
  if (!stateCheck.valid) throw httpError(400, stateCheck.reason);
  const { userId } = stateCheck;

  const adapter = requireConfigured(platform);

  let tokens;
  try {
    tokens = await adapter.handleCallback({ code, redirectUri: process.env[`${platform}_REDIRECT_URI`] });
  } catch (err) {
    await auditService.log({ actorId: userId, actorRole: null, action: "Social verification failed", targetType: "SocialAccount", targetId: platform, details: `Token exchange failed: ${err.message}` });
    throw httpError(502, `Could not complete ${platform} authorization. Please try again.`);
  }

  let profile;
  try {
    profile = await adapter.getProfile({ accessToken: tokens.accessToken });
  } catch (err) {
    await auditService.log({ actorId: userId, actorRole: null, action: "Social verification failed", targetType: "SocialAccount", targetId: platform, details: `Profile fetch failed: ${err.message}` });
    throw httpError(502, `Connected to ${platform}, but could not read the account's profile. Please try again.`);
  }

  // Metrics are best-effort — a metrics failure should not block the
  // connection itself from being marked VERIFIED (§7 covers "unavailable",
  // not "connection failed").
  let metrics = { followerCount: null, followingCount: null, mediaCount: null, engagementMetrics: null };
  try {
    metrics = await adapter.getMetrics({ accessToken: tokens.accessToken });
  } catch (_) {
    // fall through with nulls — sync can retry later
  }

  const ts = nowIso();
  const expiresAt = tokens.expiresInSeconds ? new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString() : null;

  await transaction(async () => {
    const existing = await get(
      "SELECT * FROM social_accounts WHERE user_id = ? AND platform = ? AND connected_via = 'OAUTH' FOR UPDATE",
      [userId, platform]
    );

    const row = {
      platform_user_id: profile.platformUserId,
      username: profile.username,
      display_name: profile.displayName,
      profile_url: profile.profileUrl,
      profile_image_url: profile.profileImageUrl,
      access_token_encrypted: encrypt(tokens.accessToken),
      refresh_token_encrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      token_expires_at: expiresAt,
      scopes: JSON.stringify(tokens.scopes || []),
      connected_via: "OAUTH",
      verification_status: "VERIFIED",
      last_verified_at: ts,
      follower_count: metrics.followerCount,
      following_count: metrics.followingCount,
      media_count: metrics.mediaCount,
      engagement_metrics: metrics.engagementMetrics ? JSON.stringify(metrics.engagementMetrics) : null,
      last_synced_at: ts,
      last_sync_error: null,
    };

    if (existing) {
      await run(
        `UPDATE social_accounts SET
           platform_user_id=?, username=?, display_name=?, profile_url=?, profile_image_url=?,
           access_token_encrypted=?, refresh_token_encrypted=?, token_expires_at=?, scopes=?,
           connected_via=?, verification_status=?, last_verified_at=?, follower_count=?, following_count=?,
           media_count=?, engagement_metrics=?, last_synced_at=?, last_sync_error=?, updated_at=?
         WHERE id=?`,
        [
          row.platform_user_id, row.username, row.display_name, row.profile_url, row.profile_image_url,
          row.access_token_encrypted, row.refresh_token_encrypted, row.token_expires_at, row.scopes,
          row.connected_via, row.verification_status, row.last_verified_at, row.follower_count, row.following_count,
          row.media_count, row.engagement_metrics, row.last_synced_at, row.last_sync_error, ts, existing.id,
        ]
      );
    } else {
      await run(
        `INSERT INTO social_accounts (
           id, user_id, platform, handle, profile_url, followers, engagement_rate,
           platform_user_id, username, display_name, profile_image_url,
           access_token_encrypted, refresh_token_encrypted, token_expires_at, scopes,
           connected_via, verification_status, last_verified_at, follower_count, following_count,
           media_count, engagement_metrics, last_synced_at, last_sync_error, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId("soc"), userId, platform, row.username || row.platform_user_id, row.profile_url, row.follower_count || 0, 0,
          row.platform_user_id, row.username, row.display_name, row.profile_image_url,
          row.access_token_encrypted, row.refresh_token_encrypted, row.token_expires_at, row.scopes,
          row.connected_via, row.verification_status, row.last_verified_at, row.follower_count, row.following_count,
          row.media_count, row.engagement_metrics, row.last_synced_at, row.last_sync_error, ts, ts,
        ]
      );
    }

    await auditService.log({ actorId: userId, actorRole: null, action: "Social account connected", targetType: "SocialAccount", targetId: platform, details: `${platform}: verification successful` });
  });

  await notificationService.notify(userId, { icon: "success", title: `${platform} connected`, body: `Your ${platform} account is now verified.` });

  return { userId, platform, status: "VERIFIED" };
}

// ---------------------------------------------------------------------------
// Listing (never returns tokens)
// ---------------------------------------------------------------------------
function serialize(row) {
  return {
    id: row.id,
    platform: row.platform,
    connectedVia: row.connected_via,
    verificationStatus: row.verification_status,
    username: row.username || row.handle,
    displayName: row.display_name,
    profileUrl: row.profile_url,
    profileImageUrl: row.profile_image_url,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    mediaCount: row.media_count,
    engagementMetrics: row.engagement_metrics ? JSON.parse(row.engagement_metrics) : null,
    lastVerifiedAt: row.last_verified_at,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    // Deliberately omitted: access_token_encrypted, refresh_token_encrypted — never serialized, ever.
  };
}

async function listForUser(userId) {
  const rows = await all("SELECT * FROM social_accounts WHERE user_id = ? ORDER BY platform ASC", [userId]);
  return rows.map(serialize);
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------
async function disconnect({ userId, accountId }) {
  const account = await get("SELECT * FROM social_accounts WHERE id = ?", [accountId]);
  if (!account) throw httpError(404, "Social account not found");
  if (account.user_id !== userId) throw httpError(403, "Not your social account"); // §12 — users can only manage their own connections

  if (account.connected_via === "OAUTH" && account.access_token_encrypted) {
    try {
      const adapter = getAdapter(account.platform);
      const accessToken = decrypt(account.access_token_encrypted);
      const refreshToken = account.refresh_token_encrypted ? decrypt(account.refresh_token_encrypted) : null;
      await adapter.revoke({ accessToken, refreshToken }); // best-effort; disconnect proceeds either way
    } catch (_) {
      // Provider revocation is best-effort — local removal below is what actually matters for our side.
    }
  }

  const ts = nowIso();
  await run(
    `UPDATE social_accounts SET
       verification_status='REVOKED', access_token_encrypted=NULL, refresh_token_encrypted=NULL,
       token_expires_at=NULL, updated_at=?
     WHERE id=?`,
    [ts, accountId]
  ); // secure deletion of token material on disconnect (§3/§10) — the row itself is kept for campaign-history integrity, only the tokens are wiped

  await auditService.log({ actorId: userId, actorRole: null, action: "Social account disconnected", targetType: "SocialAccount", targetId: account.platform });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Token refresh (called from sync, and opportunistically before eligibility checks)
// ---------------------------------------------------------------------------
async function ensureFreshToken(account) {
  if (account.connected_via !== "OAUTH" || !account.access_token_encrypted) return account;
  if (!account.token_expires_at) return account; // some platforms' tokens don't expire on a known schedule
  const expiresAt = new Date(account.token_expires_at).getTime();
  if (Date.now() < expiresAt - REFRESH_MARGIN_MS) return account; // still fresh

  const adapter = getAdapter(account.platform);
  const refreshTokenValue = account.refresh_token_encrypted ? decrypt(account.refresh_token_encrypted) : null;
  if (!refreshTokenValue) {
    await markExpired(account, "No refresh token available");
    return get("SELECT * FROM social_accounts WHERE id = ?", [account.id]);
  }

  try {
    const refreshed = await adapter.refreshToken({ refreshToken: refreshTokenValue });
    const ts = nowIso();
    const newExpiresAt = refreshed.expiresInSeconds ? new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString() : null;
    await run(
      `UPDATE social_accounts SET access_token_encrypted=?, refresh_token_encrypted=?, token_expires_at=?, verification_status='VERIFIED', updated_at=? WHERE id=?`,
      [encrypt(refreshed.accessToken), encrypt(refreshed.refreshToken || refreshTokenValue), newExpiresAt, ts, account.id]
    );
    await auditService.log({ actorId: account.user_id, actorRole: null, action: "Social token refreshed", targetType: "SocialAccount", targetId: account.platform });
    return get("SELECT * FROM social_accounts WHERE id = ?", [account.id]);
  } catch (err) {
    if (err instanceof RefreshNotSupportedError) {
      await markExpired(account, err.message);
    } else {
      // A transient failure still results in EXPIRED rather than a retry
      // loop — §11 explicitly says not to keep retrying a permanently
      // invalid token, and we can't distinguish "transient" from
      // "permanently invalid" from here without another sync attempt later.
      await markExpired(account, `Refresh failed: ${err.message}`);
    }
    return get("SELECT * FROM social_accounts WHERE id = ?", [account.id]);
  }
}

async function markExpired(account, reason) {
  await run("UPDATE social_accounts SET verification_status='EXPIRED', last_sync_error=?, updated_at=? WHERE id=?", [reason, nowIso(), account.id]);
  await auditService.log({ actorId: account.user_id, actorRole: null, action: "Social token expired", targetType: "SocialAccount", targetId: account.platform, details: reason });
  await notificationService.notify(account.user_id, { icon: "alert", title: `${account.platform} connection expired`, body: `Please reconnect your ${account.platform} account to keep it verified.` });
}

// ---------------------------------------------------------------------------
// Manual / scheduled metric sync
// ---------------------------------------------------------------------------
async function syncOne(accountId, userId) {
  let account = await get("SELECT * FROM social_accounts WHERE id = ?", [accountId]);
  if (!account) throw httpError(404, "Social account not found");
  if (account.user_id !== userId) throw httpError(403, "Not your social account");
  if (account.connected_via !== "OAUTH") throw httpError(400, "Only OAuth-connected accounts can be synced");

  account = await ensureFreshToken(account);
  if (account.verification_status === "EXPIRED" || account.verification_status === "REVOKED") {
    throw httpError(409, `This connection is ${account.verification_status.toLowerCase()} — reconnect to sync again`);
  }

  const adapter = getAdapter(account.platform);
  const accessToken = decrypt(account.access_token_encrypted);
  const ts = nowIso();
  try {
    const metrics = await adapter.getMetrics({ accessToken });
    await run(
      `UPDATE social_accounts SET follower_count=?, following_count=?, media_count=?, engagement_metrics=?, last_synced_at=?, last_sync_error=NULL, updated_at=? WHERE id=?`,
      [metrics.followerCount, metrics.followingCount, metrics.mediaCount, metrics.engagementMetrics ? JSON.stringify(metrics.engagementMetrics) : null, ts, ts, account.id]
    );
  } catch (err) {
    await run("UPDATE social_accounts SET last_sync_error=?, updated_at=? WHERE id=?", [err.message, ts, account.id]);
    throw httpError(502, `Failed to sync ${account.platform}: ${err.message}`);
  }

  return serialize(await get("SELECT * FROM social_accounts WHERE id = ?", [accountId]));
}

// ---------------------------------------------------------------------------
// Server-side eligibility evaluation (§9) — the ONLY place campaign
// application eligibility is decided. Never trusts anything the creator's
// request body claims about their own follower/engagement numbers.
// ---------------------------------------------------------------------------
async function evaluateEligibility({ creatorId, campaign }) {
  const hasRequirements = campaign.creator_min_followers != null || campaign.creator_min_engagement_bps != null || campaign.creator_required_country != null;
  if (!hasRequirements) return { eligible: true, reasons: [] }; // no advertiser-set requirements — preserves the pre-existing "apply with just a self-reported account, or none" behavior

  const reasons = [];

  let account = await get(
    "SELECT * FROM social_accounts WHERE user_id = ? AND platform = ? AND connected_via = 'OAUTH' AND verification_status IN ('VERIFIED','EXPIRED')",
    [creatorId, campaign.platform]
  );
  if (account && account.verification_status !== "REVOKED") account = await ensureFreshToken(account); // opportunistic refresh so a nearly-expired token doesn't block a real applicant
  if (!account || account.verification_status !== "VERIFIED") {
    reasons.push(`Requires a verified ${campaign.platform} account (connect and verify it in Settings → Social Accounts before applying)`);
    return { eligible: false, reasons };
  }

  if (campaign.creator_min_followers != null) {
    if (account.follower_count == null) reasons.push(`Follower count is not yet synced for your verified ${campaign.platform} account`);
    else if (account.follower_count < campaign.creator_min_followers) reasons.push(`Requires at least ${campaign.creator_min_followers.toLocaleString()} followers (you have ${account.follower_count.toLocaleString()})`);
  }
  if (campaign.creator_min_engagement_bps != null) {
    const engagementBps = account.engagement_metrics ? JSON.parse(account.engagement_metrics).engagementBps : null;
    if (engagementBps == null) reasons.push(`Engagement rate is not available for your verified ${campaign.platform} account`);
    else if (engagementBps < campaign.creator_min_engagement_bps) reasons.push(`Requires at least ${(campaign.creator_min_engagement_bps / 100).toFixed(1)}% engagement (you have ${(engagementBps / 100).toFixed(1)}%)`);
  }
  if (campaign.creator_required_country) {
    const profile = await get("SELECT country FROM profiles WHERE user_id = ?", [creatorId]);
    if (profile?.country !== campaign.creator_required_country) reasons.push(`Requires creators located in ${campaign.creator_required_country}`);
  }

  return { eligible: reasons.length === 0, reasons };
}

module.exports = {
  beginConnect,
  handleCallback,
  listForUser,
  disconnect,
  syncOne,
  ensureFreshToken,
  evaluateEligibility,
  serialize,
};
