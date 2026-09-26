// Development-only seed data. NEVER runs in production — see the guard
// below, which exits before touching the database at all if
// NODE_ENV=production, regardless of how this script is invoked.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { get, run, nowIso, closePool } = require("./index");
const { newId } = require("../utils/ids");
const settingsService = require("../services/settingsService");

async function upsertAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@socialboost.market";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const existing = await get("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) {
    console.log(`Admin already exists: ${email}`);
    return;
  }
  const id = newId("usr");
  const ts = nowIso();
  const passwordHash = await bcrypt.hash(password, 10);
  await run(
    `INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 'ADMIN', 0, 1, ?, ?)`,
    [id, email, passwordHash, ts, ts]
  );
  await run(
    `INSERT INTO profiles (id, user_id, display_name, languages, categories, created_at, updated_at)
     VALUES (?, ?, 'Platform Admin', '[]', '[]', ?, ?)`,
    [newId("prf"), id, ts, ts]
  );
  await run(
    `INSERT INTO wallets (id, user_id, balance_cents, pending_cents, total_earned_cents, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, ?, ?)`,
    [newId("wal"), id, ts, ts]
  );
  console.log(`Created admin user: ${email} / ${password}  (CHANGE THIS PASSWORD — see README)`);
}

/**
 * A handful of clearly-fake, clearly-labeled demo accounts/campaigns so a
 * fresh local checkout has something to click through. Every seeded user's
 * email is under the reserved @seed.socialboost.local domain so it's
 * unmistakable as test data, and no seeded account is ever given a
 * pre-existing wallet balance — wallets only ever gain balance through the
 * real funding/payout code paths, even in the seed script.
 */
async function seedDemoData() {
  const existing = await get("SELECT id FROM users WHERE email = ?", ["advertiser@seed.socialboost.local"]);
  if (existing) {
    console.log("Demo data already seeded.");
    return;
  }

  const ts = nowIso();
  const passwordHash = await bcrypt.hash("DemoPass123!", 10);

  const advertiserId = newId("usr");
  await run(
    `INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at)
     VALUES (?, 'advertiser@seed.socialboost.local', ?, 'ADVERTISER', 0, 1, ?, ?)`,
    [advertiserId, passwordHash, ts, ts]
  );
  await run(
    `INSERT INTO profiles (id, user_id, display_name, languages, categories, created_at, updated_at)
     VALUES (?, ?, 'Demo Advertiser (seed)', '[]', '[]', ?, ?)`,
    [newId("prf"), advertiserId, ts, ts]
  );
  await run(
    `INSERT INTO wallets (id, user_id, balance_cents, pending_cents, total_earned_cents, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, ?, ?)`,
    [newId("wal"), advertiserId, ts, ts]
  );

  const creatorId = newId("usr");
  await run(
    `INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at)
     VALUES (?, 'creator@seed.socialboost.local', ?, 'CREATOR', 0, 1, ?, ?)`,
    [creatorId, passwordHash, ts, ts]
  );
  await run(
    `INSERT INTO profiles (id, user_id, display_name, languages, categories, created_at, updated_at)
     VALUES (?, ?, 'Demo Creator (seed)', '[]', '[]', ?, ?)`,
    [newId("prf"), creatorId, ts, ts]
  );
  await run(
    `INSERT INTO wallets (id, user_id, balance_cents, pending_cents, total_earned_cents, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, ?, ?)`,
    [newId("wal"), creatorId, ts, ts]
  );

  console.log("Seeded demo accounts (password for both: DemoPass123!):");
  console.log("  advertiser@seed.socialboost.local");
  console.log("  creator@seed.socialboost.local");
}

async function main() {
  if ((process.env.NODE_ENV || "development") === "production") {
    console.error("Refusing to seed: NODE_ENV=production. Seed data must never run in production.");
    process.exitCode = 1;
    return;
  }
  await upsertAdmin();
  await settingsService.getSettings(); // ensures the platform_settings singleton row exists
  console.log("Platform settings initialized.");
  if (process.env.SEED_DEMO_DATA !== "false") {
    await seedDemoData();
  }
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
