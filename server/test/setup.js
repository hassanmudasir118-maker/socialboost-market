// Shared test setup. These are integration tests against a REAL Postgres —
// there is no mock database anywhere in this codebase (see PRODUCTION
// SAFETY requirements in the migration brief). Point DATABASE_URL at a
// disposable database before running `npm test` — never your dev or
// production database, since this truncates every table between tests.
//
//   docker compose up -d postgres
//   DATABASE_URL=postgres://socialboost:socialboost@localhost:5432/socialboost_test npm test
//
// This file could not be executed in the sandbox that produced it (no
// network/DB access there) — see PRODUCTION_READINESS.md for what has and
// hasn't been verified.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-do-not-use-in-production";
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "mock";
process.env.PAYMENT_TEST_MODE = "true";
process.env.PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "test-webhook-secret";
process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || require("crypto").randomBytes(32).toString("base64");
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL to a disposable test database before running tests, e.g. postgres://socialboost:socialboost@localhost:5432/socialboost_test");
}
if (!/test/i.test(process.env.DATABASE_URL)) {
  throw new Error('DATABASE_URL does not look like a test database (expected "test" in the name) — refusing to truncate it. Use a dedicated test database.');
}

const { execSync } = require("child_process");
const path = require("path");
const { pool, run, closePool } = require("../src/db");

async function setupDatabase() {
  execSync(`node ${path.join(__dirname, "..", "src", "db", "migrate.js")} up`, {
    env: process.env,
    stdio: "inherit",
  });
}

const TABLES = [
  "admin_audit_logs", "webhook_events", "payments", "transactions", "withdrawals",
  "wallet_ledger", "wallets", "campaign_escrow", "disputes", "reviews", "messages",
  "notifications", "deliverable_versions", "campaign_deliverables", "campaign_assignments",
  "campaign_status_history", "campaign_applications", "campaign_requirements", "campaigns",
  "social_accounts", "oauth_states", "referrals", "user_sessions", "password_reset_tokens",
  "email_verification_tokens", "profiles", "promo_codes", "users",
];

/** Empties every application table between tests so each test starts from a clean slate. */
async function truncateAll() {
  await run(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

async function teardown() {
  await closePool();
}

module.exports = { setupDatabase, truncateAll, teardown, pool };
