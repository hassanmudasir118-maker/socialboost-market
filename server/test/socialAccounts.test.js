const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { setupDatabase, truncateAll, teardown } = require("./setup");
const { get, run, nowIso } = require("../src/db");
const { newId } = require("../src/utils/ids");
const bcrypt = require("bcryptjs");

const socialProviders = require("../src/services/socialProviders");
const socialAccountService = require("../src/services/socialAccountService");
const oauthStateService = require("../src/services/oauthStateService");

before(async () => {
  await setupDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

after(async () => {
  await teardown();
});

async function createUser(role) {
  const id = newId("usr");
  const ts = nowIso();
  await run(
    `INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
    [id, `${id}@test.local`, await bcrypt.hash("Password123!", 4), role, ts, ts]
  );
  await run(`INSERT INTO profiles (id, user_id, display_name, languages, categories, created_at, updated_at) VALUES (?, ?, 'Test User', '[]', '[]', ?, ?)`, [newId("prf"), id, ts, ts]);
  return id;
}

// ---------------------------------------------------------------------------
// Fake adapter — used in place of the real YOUTUBE adapter for every test
// below, via socialProviders._setAdapterForTesting. Its isConfigured()
// always returns true (as if the platform's OAuth were fully set up), and
// handleCallback()/getProfile()/getMetrics()/refreshToken()/revoke() are
// scripted per test rather than making any real HTTP call.
// ---------------------------------------------------------------------------
const REAL_YOUTUBE_ADAPTER = socialProviders.getAdapter("YOUTUBE");

function installFakeAdapter(overrides = {}) {
  const fake = {
    name: "YOUTUBE",
    isConfigured: () => true,
    getAuthorizationUrl: ({ state }) => `https://fake-provider.test/authorize?state=${state}`,
    handleCallback: async ({ code }) => {
      if (code === "bad-code") throw new Error("invalid_grant");
      return { accessToken: `fake-access-${code}`, refreshToken: `fake-refresh-${code}`, expiresInSeconds: 3600, scopes: ["read"] };
    },
    getProfile: async ({ accessToken }) => ({
      platformUserId: `platform-user-${accessToken}`,
      username: "fakeuser",
      displayName: "Fake User",
      profileUrl: "https://youtube.com/fakeuser",
      profileImageUrl: "https://example.com/avatar.png",
    }),
    getMetrics: async () => ({ followerCount: 50000, followingCount: null, mediaCount: 120, engagementMetrics: { engagementBps: 350 } }),
    refreshToken: async ({ refreshToken }) => {
      if (refreshToken === "expired-refresh-token") throw new Error("invalid_grant: refresh token revoked");
      return { accessToken: `refreshed-${refreshToken}`, refreshToken, expiresInSeconds: 3600 };
    },
    revoke: async () => true,
    ...overrides,
  };
  socialProviders._setAdapterForTesting("YOUTUBE", fake);
  return fake;
}
function uninstallFakeAdapter() {
  socialProviders._restoreAdapter("YOUTUBE", REAL_YOUTUBE_ADAPTER);
}

// ---------------------------------------------------------------------------
// OAuth state validation
// ---------------------------------------------------------------------------
test("a freshly issued state is valid exactly once", async () => {
  const userId = await createUser("CREATOR");
  const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });

  const first = await oauthStateService.consumeState({ state, platform: "YOUTUBE" });
  assert.equal(first.valid, true);
  assert.equal(first.userId, userId);

  const second = await oauthStateService.consumeState({ state, platform: "YOUTUBE" });
  assert.equal(second.valid, false);
  assert.match(second.reason, /already been used/);
});

test("an unrecognized state is rejected", async () => {
  const result = await oauthStateService.consumeState({ state: "totally-made-up-state-value", platform: "YOUTUBE" });
  assert.equal(result.valid, false);
  assert.match(result.reason, /Unrecognized/);
});

test("a state issued for one platform is rejected on a different platform's callback (callback injection)", async () => {
  const userId = await createUser("CREATOR");
  const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
  const result = await oauthStateService.consumeState({ state, platform: "TIKTOK" });
  assert.equal(result.valid, false);
  assert.match(result.reason, /Platform mismatch/);
});

test("an expired state is rejected", async () => {
  const userId = await createUser("CREATOR");
  // Insert an already-expired state row directly, bypassing the normal 10-minute TTL.
  const crypto = require("crypto");
  const state = crypto.randomBytes(32).toString("base64url");
  const stateHash = crypto.createHash("sha256").update(state).digest("hex");
  await run(
    `INSERT INTO oauth_states (id, state_hash, user_id, platform, redirect_uri, expires_at, created_at) VALUES (?, ?, ?, 'YOUTUBE', 'https://app.test/callback', ?, ?)`,
    [newId("ost"), stateHash, userId, new Date(Date.now() - 1000).toISOString(), nowIso()]
  );
  const result = await oauthStateService.consumeState({ state, platform: "YOUTUBE" });
  assert.equal(result.valid, false);
  assert.match(result.reason, /expired/);
});

// ---------------------------------------------------------------------------
// Successful / invalid callback
// ---------------------------------------------------------------------------
test("a successful callback stores an encrypted, verified connection and never leaks the raw token", async () => {
  installFakeAdapter();
  try {
    const userId = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });

    const result = await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state });
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.userId, userId);

    const row = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [userId]);
    assert.equal(row.verification_status, "VERIFIED");
    assert.equal(row.connected_via, "OAUTH");
    assert.notEqual(row.access_token_encrypted, "fake-access-good-code"); // must be encrypted, not the raw token
    assert.ok(row.access_token_encrypted.includes(":")); // matches our iv:tag:ciphertext format

    const serialized = socialAccountService.serialize(row);
    assert.equal(serialized.accessTokenEncrypted, undefined);
    assert.equal(serialized.access_token_encrypted, undefined);
    assert.equal(JSON.stringify(serialized).includes("fake-access-good-code"), false);
  } finally {
    uninstallFakeAdapter();
  }
});

test("a callback with a provider error does not create or verify any connection", async () => {
  const userId = await createUser("CREATOR");
  const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });

  await assert.rejects(
    socialAccountService.handleCallback({ platform: "YOUTUBE", code: null, state, error: "access_denied" }),
    /not completed/
  );
  const row = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [userId]);
  assert.equal(row, null);
});

test("a callback with an invalid state is rejected before any token exchange is attempted", async () => {
  await assert.rejects(
    socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state: "not-a-real-state" }),
    /Unrecognized/
  );
});

test("a callback whose token exchange fails is recorded as a failed verification, not a connected account", async () => {
  installFakeAdapter();
  try {
    const userId = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await assert.rejects(socialAccountService.handleCallback({ platform: "YOUTUBE", code: "bad-code", state }), /Could not complete/);
    const row = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [userId]);
    assert.equal(row, null);
  } finally {
    uninstallFakeAdapter();
  }
});

// ---------------------------------------------------------------------------
// Expired token / refresh failure
// ---------------------------------------------------------------------------
test("refreshing a token close to expiry succeeds and stays VERIFIED", async () => {
  installFakeAdapter();
  try {
    const userId = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state });

    let row = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [userId]);
    // Force it to look almost-expired so ensureFreshToken() actually refreshes it.
    await run("UPDATE social_accounts SET token_expires_at = ? WHERE id = ?", [new Date(Date.now() + 60_000).toISOString(), row.id]);
    row = await get("SELECT * FROM social_accounts WHERE id = ?", [row.id]);

    const refreshed = await socialAccountService.ensureFreshToken(row);
    assert.equal(refreshed.verification_status, "VERIFIED");
  } finally {
    uninstallFakeAdapter();
  }
});

test("a refresh failure marks the connection EXPIRED and does not retry in a loop", async () => {
  installFakeAdapter();
  try {
    const userId = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "expired-refresh-token", state });

    let row = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [userId]);
    await run("UPDATE social_accounts SET token_expires_at = ? WHERE id = ?", [new Date(Date.now() + 60_000).toISOString(), row.id]);
    row = await get("SELECT * FROM social_accounts WHERE id = ?", [row.id]);

    const result = await socialAccountService.ensureFreshToken(row);
    assert.equal(result.verification_status, "EXPIRED");
    assert.match(result.last_sync_error, /refresh token revoked|invalid_grant/);

    // Calling it again should not throw or loop — it just observes the same EXPIRED state.
    const secondCall = await socialAccountService.ensureFreshToken(result);
    assert.equal(secondCall.verification_status, "EXPIRED");
  } finally {
    uninstallFakeAdapter();
  }
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------
test("disconnect wipes token material but keeps the row (for campaign-history integrity)", async () => {
  installFakeAdapter();
  try {
    const userId = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state });
    const before = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [userId]);

    await socialAccountService.disconnect({ userId, accountId: before.id });

    const after = await get("SELECT * FROM social_accounts WHERE id = ?", [before.id]);
    assert.ok(after, "row must still exist");
    assert.equal(after.verification_status, "REVOKED");
    assert.equal(after.access_token_encrypted, null);
    assert.equal(after.refresh_token_encrypted, null);
  } finally {
    uninstallFakeAdapter();
  }
});

// ---------------------------------------------------------------------------
// Unauthorized / cross-user access
// ---------------------------------------------------------------------------
test("a user cannot disconnect another user's social account", async () => {
  installFakeAdapter();
  try {
    const owner = await createUser("CREATOR");
    const attacker = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId: owner, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state });
    const account = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [owner]);

    await assert.rejects(socialAccountService.disconnect({ userId: attacker, accountId: account.id }), /Not your social account/);

    const stillThere = await get("SELECT * FROM social_accounts WHERE id = ?", [account.id]);
    assert.notEqual(stillThere.verification_status, "REVOKED"); // the attacker's attempt must not have changed anything
  } finally {
    uninstallFakeAdapter();
  }
});

test("a user cannot sync another user's social account", async () => {
  installFakeAdapter();
  try {
    const owner = await createUser("CREATOR");
    const attacker = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId: owner, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state });
    const account = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [owner]);

    await assert.rejects(socialAccountService.syncOne(account.id, attacker), /Not your social account/);
  } finally {
    uninstallFakeAdapter();
  }
});

test("an account-linking attempt (attacker's state used to try to attach to victim's session) is impossible by construction", async () => {
  // There is no code path where a callback can be told "attach this to user
  // X" other than through the state row's own recorded user_id — the
  // callback route never accepts a user id from the request. This test
  // documents that guarantee: consumeState always returns the ISSUING user,
  // regardless of who might have delivered the callback request.
  const victim = await createUser("CREATOR");
  const state = await oauthStateService.issueState({ userId: victim, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
  const result = await oauthStateService.consumeState({ state, platform: "YOUTUBE" });
  assert.equal(result.userId, victim);
});

// ---------------------------------------------------------------------------
// Metric synchronization
// ---------------------------------------------------------------------------
test("manual sync updates follower/media counts from the (fake) provider", async () => {
  let followerCount = 1000;
  installFakeAdapter({ getMetrics: async () => ({ followerCount, followingCount: null, mediaCount: 10, engagementMetrics: null }) });
  try {
    const userId = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state });
    const account = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [userId]);
    assert.equal(account.follower_count, 1000);

    followerCount = 2500; // simulate the channel gaining subscribers between syncs
    const synced = await socialAccountService.syncOne(account.id, userId);
    assert.equal(synced.followerCount, 2500);
  } finally {
    uninstallFakeAdapter();
  }
});

test("sync never invents a metric the provider didn't return", async () => {
  installFakeAdapter({ getMetrics: async () => ({ followerCount: null, followingCount: null, mediaCount: null, engagementMetrics: null }) });
  try {
    const userId = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state });
    const account = await get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE'", [userId]);
    const synced = await socialAccountService.syncOne(account.id, userId);
    assert.equal(synced.followerCount, null); // null, never a fabricated number
  } finally {
    uninstallFakeAdapter();
  }
});

// ---------------------------------------------------------------------------
// Duplicate social account prevention
// ---------------------------------------------------------------------------
test("connecting the same platform twice updates the existing OAuth row instead of creating a duplicate", async () => {
  installFakeAdapter();
  try {
    const userId = await createUser("CREATOR");

    const state1 = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state: state1 });

    const state2 = await oauthStateService.issueState({ userId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state: state2 });

    const rows = await require("../src/db").all("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'YOUTUBE' AND connected_via = 'OAUTH'", [userId]);
    assert.equal(rows.length, 1, "reconnecting the same platform must update the existing row, not insert a second one");
  } finally {
    uninstallFakeAdapter();
  }
});

test("the database rejects a concurrent duplicate active OAuth connection for the same user+platform (unique index)", async () => {
  // Bypasses the service layer to prove the DB constraint itself holds, not
  // just the application-level upsert logic above.
  const userId = await createUser("CREATOR");
  const ts = nowIso();
  await run(
    `INSERT INTO social_accounts (id, user_id, platform, handle, profile_url, followers, engagement_rate, connected_via, verification_status, created_at, updated_at)
     VALUES (?, ?, 'YOUTUBE', 'h1', 'https://x.test', 0, 0, 'OAUTH', 'VERIFIED', ?, ?)`,
    [newId("soc"), userId, ts, ts]
  );
  await assert.rejects(
    run(
      `INSERT INTO social_accounts (id, user_id, platform, handle, profile_url, followers, engagement_rate, connected_via, verification_status, created_at, updated_at)
       VALUES (?, ?, 'YOUTUBE', 'h2', 'https://y.test', 0, 0, 'OAUTH', 'VERIFIED', ?, ?)`,
      [newId("soc"), userId, ts, ts]
    ),
    /duplicate key|unique/i
  );
});

// ---------------------------------------------------------------------------
// Campaign eligibility (server-side, verified-data-only)
// ---------------------------------------------------------------------------
test("a creator without a verified account for the campaign's platform is ineligible when the campaign sets requirements", async () => {
  const creatorId = await createUser("CREATOR");
  const campaign = { platform: "YOUTUBE", creator_min_followers: 10000, creator_min_engagement_bps: null, creator_required_country: null };
  const result = await socialAccountService.evaluateEligibility({ creatorId, campaign });
  assert.equal(result.eligible, false);
  assert.match(result.reasons[0], /verified YOUTUBE account/);
});

test("a campaign with no eligibility requirements never blocks an application on connection status", async () => {
  const creatorId = await createUser("CREATOR");
  const campaign = { platform: "YOUTUBE", creator_min_followers: null, creator_min_engagement_bps: null, creator_required_country: null };
  const result = await socialAccountService.evaluateEligibility({ creatorId, campaign });
  assert.equal(result.eligible, true);
});

test("a verified creator meeting the minimum followers is eligible; one below it is not", async () => {
  installFakeAdapter({ getMetrics: async () => ({ followerCount: 5000, followingCount: null, mediaCount: null, engagementMetrics: null }) });
  try {
    const creatorId = await createUser("CREATOR");
    const state = await oauthStateService.issueState({ userId: creatorId, platform: "YOUTUBE", redirectUri: "https://app.test/callback" });
    await socialAccountService.handleCallback({ platform: "YOUTUBE", code: "good-code", state });

    const tooHigh = { platform: "YOUTUBE", creator_min_followers: 10000, creator_min_engagement_bps: null, creator_required_country: null };
    const result1 = await socialAccountService.evaluateEligibility({ creatorId, campaign: tooHigh });
    assert.equal(result1.eligible, false);

    const withinReach = { platform: "YOUTUBE", creator_min_followers: 1000, creator_min_engagement_bps: null, creator_required_country: null };
    const result2 = await socialAccountService.evaluateEligibility({ creatorId, campaign: withinReach });
    assert.equal(result2.eligible, true);
  } finally {
    uninstallFakeAdapter();
  }
});
