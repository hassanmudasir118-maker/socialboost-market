const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { setupDatabase, truncateAll, teardown } = require("./setup");
const { get, run, nowIso } = require("../src/db");
const { newId } = require("../src/utils/ids");
const bcrypt = require("bcryptjs");

process.env.PAYMENT_PROVIDER = "stripe"; // stripeConnectService.stripe() refuses to run otherwise
const stripeConnectService = require("../src/services/stripeConnectService");

before(async () => {
  await setupDatabase();
});
beforeEach(async () => {
  await truncateAll();
});
after(async () => {
  await teardown();
});

async function createCreatorWithWallet() {
  const id = newId("usr");
  const ts = nowIso();
  await run(`INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at) VALUES (?, ?, ?, 'CREATOR', 0, 1, ?, ?)`, [id, `${id}@test.local`, await bcrypt.hash("x", 4), ts, ts]);
  await run(`INSERT INTO wallets (id, user_id, balance_cents, pending_cents, total_earned_cents, created_at, updated_at) VALUES (?, ?, 0, 0, 0, ?, ?)`, [newId("wal"), id, ts, ts]);
  return id;
}

test("a wallet with no connected account reports not-connected", async () => {
  const userId = await createCreatorWithWallet();
  const status = await stripeConnectService.getStatus(userId);
  assert.deepEqual(status, { connected: false, payoutsEnabled: false });
});

test("beginOnboarding creates a connected account exactly once, reusing it on a second call", async () => {
  const userId = await createCreatorWithWallet();
  let createCount = 0;
  const fakeStripe = {
    createConnectedAccount: async () => { createCount++; return { accountId: "acct_fake_123" }; },
    createAccountLink: async ({ accountId }) => ({ url: `https://connect.stripe.test/setup/${accountId}` }),
  };
  // Swap in a fake without touching the real network-calling stripeProvider —
  // stripeConnectService.stripe() does a fresh require() each call, so
  // overriding the module cache entry works cleanly here.
  require.cache[require.resolve("../src/services/paymentProvider/stripeProvider")].exports = fakeStripe;

  const first = await stripeConnectService.beginOnboarding({ userId, email: "a@test.local" });
  const second = await stripeConnectService.beginOnboarding({ userId, email: "a@test.local" });

  assert.equal(createCount, 1, "the connected account must only be created once, not on every onboarding link request");
  assert.match(first.url, /acct_fake_123/);
  assert.match(second.url, /acct_fake_123/);

  const wallet = await get("SELECT stripe_connected_account_id FROM wallets WHERE user_id = ?", [userId]);
  assert.equal(wallet.stripe_connected_account_id, "acct_fake_123");
});

test("account.updated with payouts_enabled=true marks the wallet ready and notifies once", async () => {
  const userId = await createCreatorWithWallet();
  await run("UPDATE wallets SET stripe_connected_account_id = ? WHERE user_id = ?", ["acct_abc", userId]);

  await stripeConnectService.handleAccountUpdated({ id: "acct_abc", payouts_enabled: true });
  const wallet = await get("SELECT * FROM wallets WHERE user_id = ?", [userId]);
  assert.equal(wallet.stripe_payouts_enabled, 1);

  const notif = await get("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", [userId]);
  assert.match(notif.title, /ready/i);
});

test("account.updated for an unknown account id is a safe no-op", async () => {
  const result = await stripeConnectService.handleAccountUpdated({ id: "acct_never_created", payouts_enabled: true });
  assert.deepEqual(result, { ok: true, ignored: true });
});

test("payouts toggling back to disabled updates the wallet and notifies", async () => {
  const userId = await createCreatorWithWallet();
  await run("UPDATE wallets SET stripe_connected_account_id = ?, stripe_payouts_enabled = 1 WHERE user_id = ?", ["acct_xyz", userId]);

  await stripeConnectService.handleAccountUpdated({ id: "acct_xyz", payouts_enabled: false });
  const wallet = await get("SELECT * FROM wallets WHERE user_id = ?", [userId]);
  assert.equal(wallet.stripe_payouts_enabled, 0);

  const notif = await get("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", [userId]);
  assert.match(notif.title, /paused/i);
});

test("createPayout refuses a creator who hasn't completed onboarding, without crashing", async () => {
  const userId = await createCreatorWithWallet(); // no stripe_connected_account_id
  const stripeProvider = require("../src/services/paymentProvider/stripeProvider");
  await assert.rejects(
    stripeProvider.createPayout({ amountCents: 1000, currency: "usd", destination: userId }),
    /hasn't finished setting up payouts/
  );
});
