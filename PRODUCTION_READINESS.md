# Production Readiness Notes

This build now fails fast if started with `NODE_ENV=production` while mock/test payments, SQLite/localhost `DATABASE_URL`, or placeholder secrets are enabled, and the test payment simulation endpoint is disabled in production.

## PostgreSQL migration status (this pass)

The backend was migrated from a `node:sqlite` runtime to PostgreSQL. **Important:** the environment this was done in had no network access — `pg` could not be installed, no Postgres instance could be started, and nothing below was actually executed. Everything was hand-reviewed against Postgres/`pg` semantics, not run. Treat this as a thorough first pass that needs verification, not a verified migration.

**Done:**
- `src/db/index.js` rewritten on `pg` (connection pool, reentrant `AsyncLocalStorage`-scoped transactions, `SELECT ... FOR UPDATE` row locking helper).
- `migrations/0001_init.sql` — the SQLite schema ported over (it turned out to already be ~100% standard SQL; only the `PRAGMA foreign_keys` line needed removing).
- `src/db/migrate.js` — versioned migration runner (`up`/`status`/`reset`), `src/db/seed.js` — dev-only, refuses to run in production.
- All 9 service files and all 8 route files converted from synchronous `db.prepare().get/run/all()` to `async`/`await` against the new layer.
- Row-level locking added to `escrowService` (fund/reserve/release/cancelReservation/refund) and `walletService` (credit/debit) — these were the concurrency gaps the migration brief specifically called out (double-allocation, overspending escrow, double-payout). Multi-step financial sequences in `admin.js` (dispute resolution) and `campaigns.js` (application accept, deliverable review) are wrapped in `db.transaction()` so they commit or roll back as one unit.
- `docker-compose.yml` + `Dockerfile` for local Postgres.
- `test/financial.test.js` — real integration tests (`node:test`, no mocking) covering user creation, campaign/application/assignment creation, commission math, payout, refund, withdrawal request/reject, webhook idempotency, concurrent-allocation and concurrent-debit race conditions, and transaction rollback. **Authored, not run.**
- `productionCheck.js` / `server.js` production guards updated to require a `postgres://`/`postgresql://` `DATABASE_URL` and reject `localhost`.
- `/api/health/database` endpoint added.

**Needs verification before this is trusted in production, in order:**
1. `docker compose up -d postgres`, `npm install`, `npm run migrate` — confirm migration 0001 applies cleanly.
2. `npm test` against a disposable test database — confirm every test in `test/financial.test.js` actually passes, especially the two concurrency tests (`Promise.allSettled` races) and the rollback test.
3. Manual smoke test of the full user flow end-to-end (register → create campaign → checkout/simulate webhook → publish → apply → accept → submit deliverable → approve → withdraw) against the running server.
4. Load-test the row-locking paths (escrow reserve, wallet credit/debit) with real concurrent requests, not just the in-process `Promise.allSettled` tests, since a connection-pool-level interaction could behave differently than in-process promises.

## Still required before taking real money

1. Select a payment provider that supports the merchant's country/business and implement its official API/hosted checkout adapter in `src/services/paymentProvider/` (the interface — `createPaymentIntent`, `verifyWebhookSignature`, `createRefund`, `createPayout`, `buildTestWebhookEvent` — is already provider-agnostic).
2. Configure the provider's production credentials through the hosting platform's secret manager; never commit them.
3. Configure a managed production Postgres instance (RDS, Supabase, Neon, etc.) with TLS (`PGSSL=require` or `verify-full`) and automated backups.
4. Configure HTTPS, the provider webhook URL, monitoring, email delivery, and file/object storage.
5. Run the production test checklist with sandbox/test credentials before switching to live mode.

The code does not invent or fake payment success, and no payment credentials should be sent to the frontend.

## Social account OAuth status (this pass)

Same environment constraint as above — no network access, so nothing below was executed against a real Google/TikTok/Meta app or a live Postgres instance. See `README.md` §6 for the full file-by-file breakdown; summarized here:

**Done:** DB migration (`0002_social_oauth.sql`), AES-256-GCM token encryption (`utils/crypto.js` — round-trip and invalid-key rejection **actually run and verified** in this sandbox, no DB needed for that part), CSRF-safe OAuth state handling, four platform adapters (YouTube/TikTok/Instagram/Facebook) behind a consistent interface, connect/callback/disconnect/sync orchestration, server-side campaign eligibility enforcement using only verified data, a "Connected platforms" settings UI, and 20 authored tests using an injected fake adapter (no real network needed to run them, but they still need a real Postgres, which this sandbox doesn't have).

**Needs verification before trusting it in production, in order:**
1. `npm run migrate` — confirm `0002_social_oauth.sql` applies cleanly on top of `0001_init.sql`.
2. `npm test` — confirm all 20 tests in `test/socialAccounts.test.js` actually pass (they were authored against the real service code and syntax-checked, but never executed).
3. Register one real developer app (start with Google/YouTube — the most standard OAuth2 flow of the four) and manually walk the connect → consent → callback → verified flow end-to-end. This is the one part no amount of unit testing substitutes for, since it's the only step that depends on a real platform's actual behavior rather than this codebase's.
4. Only after step 3 succeeds for one platform, register the remaining three (TikTok, Instagram, Facebook) — each has its own app-review requirements (noted in README §6) that can take longer than the code itself did to write.
5. Frontend changes (`AccountSettings.jsx`, `Dashboard.jsx`, `App.jsx`) were reviewed manually, not machine-verified — no JSX-capable tool was available in this sandbox without network access. Run `npm run dev` on the frontend and click through the Settings → Social platforms tab before shipping.

## Stripe payment provider status (this pass)

`src/services/paymentProvider/stripeProvider.js` implements `createPaymentIntent`, `verifyWebhookSignature`, and `createRefund` against Stripe's real REST API. **`verifyWebhookSignature`'s test suite (`test/stripeProvider.test.js`) actually ran in this sandbox — 7/7 passed** (pure crypto, no DB/network needed, unlike every other test file in this project). `createPaymentIntent`/`createRefund` themselves are unverified — they need a real Stripe test-mode key and network access to check, neither of which this sandbox has.

Fixed a real latent bug while adding this: `paymentGatewayService.js`, `paymentService.js`, and `withdrawalService.js` called the payment provider interface without `await` anywhere. Harmless with the synchronous mock, but would have silently broken the moment an async, network-calling provider (this one) was plugged in. All 5 call sites now `await`.

**`createPayout` is intentionally incomplete**: real third-party payouts require the recipient to have a Stripe Connect connected account, which requires its own onboarding flow (create the account, an Account Link for the creator to complete KYC/bank details, and an `account.updated` webhook to know when it's actually ready). That flow is not built — `migrations/0003_stripe_connect.sql` only adds the column to eventually record it. Until onboarding exists, every payout attempt correctly fails with a clear, actionable 409 instead of silently doing nothing.

**To actually verify the two unverified functions**, with a real Stripe test-mode account (free, no live money involved):
```bash
# .env: PAYMENT_PROVIDER=stripe, PAYMENT_SECRET_KEY=sk_test_..., PAYMENT_PUBLIC_KEY=pk_test_...
stripe listen --forward-to localhost:4000/api/payments/webhook   # prints a whsec_... — put it in PAYMENT_WEBHOOK_SECRET
# then walk the real checkout flow and confirm the webhook lands and escrow funds correctly
```

## Stripe Connect payout onboarding status (this pass)

Built: `stripeConnectService.js`, the `createConnectedAccount`/`createAccountLink` additions to `stripeProvider.js`, `GET/POST /api/wallet/payouts/*`, `account.updated` webhook dispatch, `test/stripeConnect.test.js` (6 tests — authored, not run, same Postgres-access constraint as every other integration suite), and the `PayoutSetupCard` UI.

**Needs verification, in order:**
1. `npm run migrate` — confirm `0003_stripe_connect.sql` applies after `0001`/`0002`.
2. `npm test` — confirm `stripeConnect.test.js` passes, especially the "creates the account exactly once" test (the whole point of storing `stripe_connected_account_id` is to never call Stripe's create-account endpoint twice for the same creator).
3. With a real Stripe test-mode key: click "Set up payouts" as a test creator account, complete Stripe's hosted onboarding with their test-mode fake data, and confirm the `account.updated` webhook actually flips `stripe_payouts_enabled` to true (also run `stripe listen --forward-to localhost:4000/api/payments/webhook` for this, same as above — Connect webhooks arrive on the same endpoint).
4. Only after step 3, test `createPayout` end-to-end by approving a withdrawal for that test creator.

## Commission / withdrawal audit — critical migration bug found and fixed (previous pass)

A real local Postgres server was used to actually run the migrations and the exact SQL statements the financial code runs, instead of reviewing by eye or against SQLite as a stand-in. This caught a bug no earlier pass could have: `migrations/0001_init.sql`'s `transactions` table had a foreign key to `payments(id)` before `payments` was created — SQLite doesn't check that a referenced table exists at `CREATE TABLE` time, so it slipped through every prior check, but Postgres rejects it outright (`relation "payments" does not exist`), and since `migrate.js` runs each file in one transaction, migration `0001` — all 28 original tables — would have **completely failed and rolled back** the first time it ran against any real Postgres database, Neon included. **Fixed** by moving `payments` above `transactions`. Re-verified this pass (see below) — still correct.

Commission math and wallet credit/debit were reviewed and found correct (idempotent payout, row-locked balance updates, immutable ledger). The real withdrawal gap found and fixed: `resolveWithdrawal()` unconditionally called the automated payout provider, which only `mockProvider`/`stripeProvider` implement — a platform without Stripe Connect configured had no way to resolve a withdrawal at all. Fixed with a `payoutMethod: "MANUAL"` option (admin pays the creator by hand, then confirms via the existing payout-completed/payout-failed endpoints) — wired into `withdrawalService.js`, `routes/admin.js`, and the admin dashboard's Withdrawals tab.

## Manual EasyPaisa (and JazzCash / bank transfer) payment method — this pass

Real EasyPaisa/JazzCash *merchant* API access needs a registered business merchant account, which does not exist yet (see the email-based registration process this chat walked through). Until that exists, this pass adds a **manual, human-confirmed checkout path** so advertisers can actually fund campaigns today:

- `migrations/0004_manual_easypaisa.sql` — adds `payment_method`, `manual_reference`, `manual_note`, `manual_review_status` (`AWAITING_REFERENCE` → `PENDING_REVIEW` → `CONFIRMED`/`REJECTED`), `manual_reviewed_by`, `manual_reviewed_at` to `payments`.
- `paymentGatewayService.js` — `getManualMethods()` (only methods with a receiving account configured in env vars are shown), `createManualCheckout()` (creates a `PENDING` payment with no provider API call), `submitManualProof()` (advertiser submits the transaction reference after sending money themselves), `resolveManualPayment()` (admin-only; confirming runs the *exact same* escrow-funding code path as a real webhook — `handlePaymentSucceeded` — rejecting marks the payment `FAILED` with no escrow funded).
- `routes/payments.js` — `GET /manual/methods`, `POST /manual-checkout`, `POST /:id/manual-proof`.
- `routes/admin.js` — `GET /payments/manual/pending`, `POST /payments/:id/manual-resolve`.
- Frontend — `PaymentBox` in `AdvertiserDashboard.jsx` now shows a "Pay via EasyPaisa" button (and JazzCash/Bank Transfer, if configured) alongside the existing test-mode checkout; shows the platform's receiving account and a reference-submission field. A new "Manual payments" tab in the admin dashboard lists pending submissions with Confirm/Reject actions.
- `.env` / `.env.example` — `PLATFORM_EASYPAISA_NAME` / `PLATFORM_EASYPAISA_NUMBER` (and the JazzCash/bank-transfer equivalents). These are the platform's own *receiving* account details shown to advertisers, not secrets.

**No `payments` row is ever marked `SUCCEEDED`, and no escrow is ever funded, from anything the client submits** — only an authenticated admin's confirm action can do that, exactly mirroring the already-existing pattern for creator payouts (`payout_provider = 'MANUAL'`).

**Verified this pass, for real, against a live local Postgres 16 instance:**
- All 4 migrations applied cleanly from empty.
- The exact SQL statements `createManualCheckout` → `submitManualProof` → `resolveManualPayment`'s confirm branch run were executed end-to-end inside a transaction (then rolled back): the payment reaches `provider=manual, status=SUCCEEDED, manual_review_status=CONFIRMED`, the campaign's escrow is funded by the correct amount, and the campaign transitions to `FUNDED` — no constraint violations anywhere.
- Every `UPDATE ... SET` / `INSERT INTO (...)` across all of `src/**/*.js` cross-checked column-by-column against the live schema — no mismatches.
- `node --check` passed on every backend file; a TypeScript-compiler-based parser passed on every frontend `.jsx`/`.js` file touched.

**Not verified (no network access in this sandbox to install `pg` and actually start the Node/Express server):**
- Clicking through the new "Pay via EasyPaisa" / admin "Manual payments" UI against a running backend.
- `npm test` end-to-end (same constraint as every pass before this one).

**This is a stopgap, not the real merchant integration.** Once a real EasyPaisa/JazzCash merchant account is approved (see the merchant-registration steps earlier in this project), that should be built as a proper `socialProviders`-style adapter with real API verification instead of a human checking a reference number by eye.



