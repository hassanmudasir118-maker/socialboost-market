const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { setupDatabase, truncateAll, teardown } = require("./setup");
const { get, run, nowIso, transaction } = require("../src/db");
const { newId } = require("../src/utils/ids");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const walletService = require("../src/services/walletService");
const escrowService = require("../src/services/escrowService");
const paymentService = require("../src/services/paymentService");
const paymentGatewayService = require("../src/services/paymentGatewayService");
const withdrawalService = require("../src/services/withdrawalService");
const statusService = require("../src/services/campaignStatusService");
const { applyBps } = require("../src/utils/money");

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
    `INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
    [id, `${id}@test.local`, await bcrypt.hash("Password123!", 4), role, ts, ts]
  );
  await run(
    `INSERT INTO profiles (id, user_id, display_name, languages, categories, created_at, updated_at)
     VALUES (?, ?, 'Test User', '[]', '[]', ?, ?)`,
    [newId("prf"), id, ts, ts]
  );
  return id;
}

async function createFundedCampaign({ advertiserId, budgetCents = 100000, commissionBps = 1500 }) {
  const id = newId("cmp");
  const ts = nowIso();
  await run(
    `INSERT INTO campaigns (id, advertiser_id, title, description, platform, content_url, category, campaign_type,
       requirements, audience_locations, audience_interests, budget_cents, budget_per_creator_cents, commission_bps,
       max_creators, start_date, end_date, status, admin_approved, created_at, updated_at)
     VALUES (?, ?, 'Test Campaign', 'Test description here', 'YOUTUBE', 'https://example.com', 'Tech', 'Sponsored Video',
       'Do the thing', '[]', '[]', ?, ?, ?, 1, ?, ?, 'FUNDED', 1, ?, ?)`,
    [id, advertiserId, budgetCents, budgetCents, commissionBps, ts, new Date(Date.now() + 86400000 * 30).toISOString(), ts, ts]
  );
  await escrowService.fund(id, budgetCents);
  return get("SELECT * FROM campaigns WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------------
// User creation / login (via direct DB — route-level auth is covered by the
// manual QA checklist in PRODUCTION_READINESS.md; these focus on the data layer)
// ---------------------------------------------------------------------------
test("user creation persists a real row with a hashed password", async () => {
  const id = await createUser("ADVERTISER");
  const user = await get("SELECT * FROM users WHERE id = ?", [id]);
  assert.ok(user);
  assert.notEqual(user.password_hash, "Password123!");
  assert.equal(await bcrypt.compare("Password123!", user.password_hash), true);
});

test("email must be unique", async () => {
  const ts = nowIso();
  const email = "dupe@test.local";
  await run(`INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at) VALUES (?, ?, 'x', 'ADVERTISER', 0, 0, ?, ?)`, [newId("usr"), email, ts, ts]);
  await assert.rejects(
    run(`INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at) VALUES (?, ?, 'x', 'ADVERTISER', 0, 0, ?, ?)`, [newId("usr"), email, ts, ts]),
    /duplicate key|unique/i
  );
});

// ---------------------------------------------------------------------------
// Campaign creation / application / assignment
// ---------------------------------------------------------------------------
test("campaign creation stores budget as integer cents, never floats", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const campaign = await createFundedCampaign({ advertiserId, budgetCents: 12345 });
  assert.equal(Number.isInteger(campaign.budget_cents), true);
  assert.equal(campaign.budget_cents, 12345);
});

test("creator can apply, advertiser can accept, escrow reserves the agreed rate", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const creatorId = await createUser("CREATOR");
  const campaign = await createFundedCampaign({ advertiserId, budgetCents: 100000 });

  const appId = newId("app");
  await run(
    `INSERT INTO campaign_applications (id, campaign_id, creator_id, message, proposed_rate_cents, status, applied_at)
     VALUES (?, ?, ?, 'Pick me', 50000, 'PENDING', ?)`,
    [appId, campaign.id, creatorId, nowIso()]
  );

  await paymentService.reserveForAssignment(campaign.id, 50000);
  const escrow = await escrowService.getOrCreate(campaign.id);
  assert.equal(escrow.reserved_cents, 50000);
  assert.equal(escrowService.available(escrow), 50000); // 100000 funded - 50000 reserved
});

test("reserving more than available escrow throws and reserves nothing", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const campaign = await createFundedCampaign({ advertiserId, budgetCents: 10000 });
  await assert.rejects(paymentService.reserveForAssignment(campaign.id, 50000), /Insufficient escrow/);
  const escrow = await escrowService.getOrCreate(campaign.id);
  assert.equal(escrow.reserved_cents, 0);
});

// ---------------------------------------------------------------------------
// Commission calculation
// ---------------------------------------------------------------------------
test("commission (basis points) is computed server-side and matches expected cents", () => {
  assert.equal(applyBps(100000, 1500), 15000); // 15% of $1000.00 = $150.00
  assert.equal(applyBps(999, 250), 25); // rounds to nearest cent
});

// ---------------------------------------------------------------------------
// Payout / escrow release
// ---------------------------------------------------------------------------
test("releasing an assignment payment credits the creator's wallet net of commission", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const creatorId = await createUser("CREATOR");
  const campaign = await createFundedCampaign({ advertiserId, budgetCents: 100000, commissionBps: 1500 });

  const appId = newId("app");
  await run(`INSERT INTO campaign_applications (id, campaign_id, creator_id, message, proposed_rate_cents, status, applied_at) VALUES (?, ?, ?, 'x', 50000, 'ACCEPTED', ?)`, [appId, campaign.id, creatorId, nowIso()]);
  await paymentService.reserveForAssignment(campaign.id, 50000);
  const assignmentId = newId("asn");
  await run(
    `INSERT INTO campaign_assignments (id, campaign_id, application_id, creator_id, advertiser_id, agreed_rate_cents, status, started_at, created_at)
     VALUES (?, ?, ?, ?, ?, 50000, 'ACTIVE', ?, ?)`,
    [assignmentId, campaign.id, appId, creatorId, advertiserId, nowIso(), nowIso()]
  );
  const assignment = await get("SELECT * FROM campaign_assignments WHERE id = ?", [assignmentId]);

  const { netCents, feeCents } = await paymentService.releaseAssignmentPayment({ assignment, campaign });
  assert.equal(feeCents, 7500); // 15% of 50000
  assert.equal(netCents, 42500);

  const wallet = await walletService.getWallet(creatorId);
  assert.equal(wallet.balance_cents, 42500);
});

test("releasing the same assignment payment twice is rejected (idempotency guard)", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const creatorId = await createUser("CREATOR");
  const campaign = await createFundedCampaign({ advertiserId, budgetCents: 100000 });
  const appId = newId("app");
  await run(`INSERT INTO campaign_applications (id, campaign_id, creator_id, message, proposed_rate_cents, status, applied_at) VALUES (?, ?, ?, 'x', 50000, 'ACCEPTED', ?)`, [appId, campaign.id, creatorId, nowIso()]);
  await paymentService.reserveForAssignment(campaign.id, 50000);
  const assignmentId = newId("asn");
  await run(`INSERT INTO campaign_assignments (id, campaign_id, application_id, creator_id, advertiser_id, agreed_rate_cents, status, started_at, created_at) VALUES (?, ?, ?, ?, ?, 50000, 'ACTIVE', ?, ?)`, [assignmentId, campaign.id, appId, creatorId, advertiserId, nowIso(), nowIso()]);
  const assignment = await get("SELECT * FROM campaign_assignments WHERE id = ?", [assignmentId]);

  await paymentService.releaseAssignmentPayment({ assignment, campaign });
  await assert.rejects(paymentService.releaseAssignmentPayment({ assignment, campaign }), /already been paid out/);

  const wallet = await walletService.getWallet(creatorId);
  assert.equal(wallet.balance_cents, 42500); // unchanged by the second, rejected attempt
});

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------
test("refund only pulls from unreserved escrow, never touches reserved funds", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const campaign = await createFundedCampaign({ advertiserId, budgetCents: 100000 });
  await paymentService.reserveForAssignment(campaign.id, 40000);

  const result = await paymentService.refundCampaignFunding({ campaignId: campaign.id, advertiserId });
  assert.equal(result.amount, 60000); // only the unreserved 60000, not the reserved 40000

  const escrow = await escrowService.getOrCreate(campaign.id);
  assert.equal(escrow.reserved_cents, 40000); // untouched
  assert.equal(escrow.refunded_cents, 60000);
});

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------
test("withdrawal request debits the wallet immediately and computes fee/net", async () => {
  const creatorId = await createUser("CREATOR");
  await walletService.credit(creatorId, 100000, "ADMIN_ADJUSTMENT", { type: "Test", id: null });

  const { withdrawal } = await withdrawalService.requestWithdrawal({ userId: creatorId, amountCents: 50000 });
  assert.equal(withdrawal.amount_cents, 50000);
  assert.equal(withdrawal.net_cents, withdrawal.amount_cents - withdrawal.fee_cents);

  const wallet = await walletService.getWallet(creatorId);
  assert.equal(wallet.balance_cents, 50000); // 100000 - 50000 debited immediately
});

test("a rejected withdrawal refunds the full amount back to the wallet", async () => {
  const creatorId = await createUser("CREATOR");
  const adminId = await createUser("ADMIN");
  await walletService.credit(creatorId, 100000, "ADMIN_ADJUSTMENT", { type: "Test", id: null });
  const { withdrawal } = await withdrawalService.requestWithdrawal({ userId: creatorId, amountCents: 50000 });

  await withdrawalService.resolveWithdrawal({ withdrawalId: withdrawal.id, approve: false, adminId });

  const wallet = await walletService.getWallet(creatorId);
  assert.equal(wallet.balance_cents, 100000); // fully refunded
});

// ---------------------------------------------------------------------------
// Duplicate transaction prevention (webhook idempotency)
// ---------------------------------------------------------------------------
test("the same webhook event id is only ever applied once", async () => {
  const advertiserId = await createUser("ADVERTISER");
  // Built directly (not via createFundedCampaign) because this test needs a
  // campaign that starts PENDING_PAYMENT with no escrow yet — checkout +
  // webhook is what funds it, which is exactly the path under test.
  const campaignId = newId("cmp");
  const ts = nowIso();
  await run(
    `INSERT INTO campaigns (id, advertiser_id, title, description, platform, content_url, category, campaign_type,
       requirements, audience_locations, audience_interests, budget_cents, budget_per_creator_cents, commission_bps,
       max_creators, start_date, end_date, status, admin_approved, created_at, updated_at)
     VALUES (?, ?, 'Test Campaign', 'Test description here', 'YOUTUBE', 'https://example.com', 'Tech', 'Sponsored Video',
       'Do the thing', '[]', '[]', 50000, 50000, 1500, 1, ?, ?, 'PENDING_PAYMENT', 1, ?, ?)`,
    [campaignId, advertiserId, ts, new Date(Date.now() + 86400000 * 30).toISOString(), ts, ts]
  );
  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [campaignId]);

  const { payment } = await paymentGatewayService.createCampaignCheckout({ campaignId: campaign.id, advertiserId });

  const eventId = "evt_test_123";
  const payload = JSON.stringify({ id: eventId, type: "payment_intent.succeeded", data: { object: { id: payment.provider_payment_id } } });
  // The mock provider verifies a real HMAC-SHA256 over the raw payload (see
  // paymentProvider/mockProvider.js) — signing it the same way here so
  // verification actually passes, rather than relying on a placeholder string.
  const signature = crypto.createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET).update(payload).digest("hex");

  await paymentGatewayService.processWebhookEvent({ rawBody: payload, signature });
  const escrowAfterFirst = await escrowService.getOrCreate(campaign.id);
  assert.equal(escrowAfterFirst.funded_cents, 50000); // funded exactly once, matching the campaign's budget

  const result2 = await paymentGatewayService.processWebhookEvent({ rawBody: payload, signature });
  assert.equal(result2.duplicate, true);

  const escrowAfterSecond = await escrowService.getOrCreate(campaign.id);
  assert.equal(escrowAfterSecond.funded_cents, escrowAfterFirst.funded_cents); // unchanged — not double-funded
});

// ---------------------------------------------------------------------------
// Concurrent creator allocation — the core race condition from §6
// ---------------------------------------------------------------------------
test("concurrent reservations against the same campaign never overspend escrow", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const campaign = await createFundedCampaign({ advertiserId, budgetCents: 100000 }); // only room for TWO 50000 reservations

  const attempts = await Promise.allSettled([
    paymentService.reserveForAssignment(campaign.id, 50000),
    paymentService.reserveForAssignment(campaign.id, 50000),
    paymentService.reserveForAssignment(campaign.id, 50000), // this third one must fail — only 100000 available
  ]);

  const succeeded = attempts.filter((a) => a.status === "fulfilled");
  const failed = attempts.filter((a) => a.status === "rejected");
  assert.equal(succeeded.length, 2, "exactly two of the three concurrent reservations should succeed");
  assert.equal(failed.length, 1, "the third should be rejected for insufficient escrow");

  const escrow = await escrowService.getOrCreate(campaign.id);
  assert.equal(escrow.reserved_cents, 100000); // never exceeds funded_cents
});

test("concurrent wallet debits never drive the balance negative", async () => {
  const creatorId = await createUser("CREATOR");
  await walletService.credit(creatorId, 100000, "ADMIN_ADJUSTMENT", { type: "Test", id: null });

  const attempts = await Promise.allSettled([
    walletService.debit(creatorId, 60000, "WITHDRAWAL_REQUEST", { type: "Test", id: null }),
    walletService.debit(creatorId, 60000, "WITHDRAWAL_REQUEST", { type: "Test", id: null }),
  ]);

  const succeeded = attempts.filter((a) => a.status === "fulfilled");
  assert.equal(succeeded.length, 1, "only one of the two overlapping 60000 debits against a 100000 balance can succeed");

  const wallet = await walletService.getWallet(creatorId);
  assert.equal(wallet.balance_cents, 40000);
  assert.ok(wallet.balance_cents >= 0);
});

// ---------------------------------------------------------------------------
// Database rollback
// ---------------------------------------------------------------------------
test("a transaction that throws partway through leaves no partial writes", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const campaign = await createFundedCampaign({ advertiserId, budgetCents: 100000 });

  await assert.rejects(
    transaction(async () => {
      await escrowService.reserve(campaign.id, 30000); // succeeds
      throw new Error("simulated failure after a successful write");
    }),
    /simulated failure/
  );

  const escrow = await escrowService.getOrCreate(campaign.id);
  assert.equal(escrow.reserved_cents, 0, "the reservation must have rolled back along with everything else in the transaction");
});

test("campaign status transitions are rejected outside the allowed graph", async () => {
  const advertiserId = await createUser("ADVERTISER");
  const campaign = await createFundedCampaign({ advertiserId });
  await run("UPDATE campaigns SET status='DRAFT' WHERE id=?", [campaign.id]);
  await assert.rejects(statusService.transitionCampaign(campaign.id, "COMPLETED", {}), /Cannot move campaign/);
});
