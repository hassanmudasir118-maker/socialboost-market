# SocialBoost Market — Production Backend Upgrade

This is the same SocialBoost Market product, now split into a real backend API
+ database and a frontend that talks to it over HTTP — instead of the
frontend-only prototype that kept everything in browser storage.

```
socialboost/
  server/   Express API + PostgreSQL — the real backend
  web/      Vite + React frontend — same UI, now calling the API
```

## 1. Files created / changed

**New backend (`server/`)** — everything here is new:
- `prisma/schema.prisma` — an alternate, browsable schema representation. **Not used by the runtime** — kept in sync (provider = postgresql) so it doesn't contradict the real database.
- `migrations/0001_init.sql` — the **authoritative, versioned schema** applied by `db/migrate.js`, 28 tables, foreign keys, indexes, CHECK constraints.
- `src/db/index.js` — the `pg`-based connection pool, transaction helper (reentrant, `AsyncLocalStorage`-scoped so nested service calls share one transaction), and row-locking helper.
- `src/db/migrate.js` — versioned migration runner (`up` / `status` / `reset`, the last dev-only).
- `src/db/seed.js` — dev-only seed script (admin account + default settings + labeled demo accounts); hard-refuses to run when `NODE_ENV=production`.
- `src/utils/ids.js`, `money.js`, `asyncHandler.js` — id generation, cents-based money helpers, async Express route wrapper.
- `src/middleware/auth.js` — JWT verification + role gating (re-reads role/suspension from the DB every request).
- `src/middleware/validate.js` — zod request validation.
- `src/services/walletService.js` — the only code path allowed to change a wallet balance (ledger-backed, row-locked, self-transactional).
- `src/services/escrowService.js` — campaign escrow fund/reserve/release/refund, row-locked.
- `src/services/paymentService.js` — escrow funding, payout release, refunds. The money-safety core.
- `src/services/withdrawalService.js` — withdrawal request/approve/reject/retry.
- `src/services/settingsService.js` — commission %, withdrawal limits, fees, categories, platforms.
- `src/services/notificationService.js`, `auditService.js`, `campaignStatusService.js`, `sessionService.js`, `paymentGatewayService.js`.
- `src/routes/auth.js`, `users.js`, `campaigns.js`, `wallet.js`, `payments.js`, `notifications.js`, `referrals.js`, `admin.js`.
- `src/app.js`, `server.js` — Express wiring, security middleware, `/api/health` + `/api/health/database`.
- `docker-compose.yml`, `Dockerfile` — local Postgres + app.
- `test/setup.js`, `test/financial.test.js` — integration tests against a real Postgres (see §7).

**New frontend (`web/`)** — Vite React app, same visual design as the original prototype:
- `src/styles.css` — the design system, ported unchanged (same colors, type, layout).
- `src/api.js` — the only place that talks to the backend (fetch + JWT).
- `src/App.jsx`, `Dashboard.jsx`, `Marketing.jsx`, `AuthPage.jsx`, `HelpCenter.jsx`, `shared.jsx`
- `src/AdvertiserDashboard.jsx`, `CreatorDashboard.jsx`, `AdminDashboard.jsx`, `Marketplace.jsx`

**Removed:** all `window.storage` calls, all mock/demo arrays (`CREATOR_PROFILES`, seeded applicants, fake transactions), every client-computed commission/balance number, and the SQLite (`node:sqlite`) runtime — see §7.

## 2. Database schema (28 tables)

`users`, `profiles`, `social_accounts`, `campaigns`, `campaign_requirements`, `campaign_applications`,
`campaign_assignments`, `campaign_deliverables`, `deliverable_versions`, `campaign_status_history`,
`campaign_escrow`, `reviews`, `messages`, `notifications`, `transactions`, `payments`, `webhook_events`,
`wallets`, `wallet_ledger`, `withdrawals`, `disputes`, `referrals`, `platform_settings`, `promo_codes`,
`admin_audit_logs`, `user_sessions`, `email_verification_tokens`, `password_reset_tokens`.

Highlights:
- All money is **integer cents** (`budget_cents`, `amount_cents`, etc.) — never floats.
- `wallets.balance_cents` is a materialized cache; `wallet_ledger` is the append-only source of truth it's derived from.
- `campaigns.commission_bps` is **snapshotted at funding time**, so a later admin rate change never retroactively changes an in-flight campaign.
- Every table has `id`, timestamps, and a `status`/enum column backed by a SQL `CHECK` constraint.
- Indexes on every foreign key and every status/filter column.
- `campaign_applications` has a `UNIQUE(campaign_id, creator_id)` constraint — one application per creator per campaign, enforced by the database, not application code.
- `reviews` has `UNIQUE(application_id, from_user_id)` — the "only one review per direction per completed collaboration" rule is a DB constraint.
- `webhook_events.provider_event_id` is `UNIQUE` — duplicate payment-provider webhook deliveries can't double-apply.

Full DDL: `server/migrations/0001_init.sql`. Alternate browsable model: `server/prisma/schema.prisma` (not executed).

## 3. API endpoints

All routes are under `/api`. Every route except `/auth/register`, `/auth/login`, and `/health` requires `Authorization: Bearer <token>`.

**Auth**
- `POST /auth/register` `{name,email,password,role,referralCode?}`
- `POST /auth/login` `{email,password}`
- `GET /auth/me`

**Users / Profiles / Social accounts**
- `GET/PATCH /users/me/profile`
- `GET/POST /users/me/social-accounts`, `DELETE /users/me/social-accounts/:id`
- `GET /users/:id/public-profile`
- `GET /users/creators?platform=&country=&category=&minFollowers=&minEngagement=&minRating=`

**Campaigns**
- `POST /campaigns` (create draft or publish)
- `GET /campaigns/mine`, `GET /campaigns/open`, `GET /campaigns/:id`, `PATCH /campaigns/:id`
- `POST /campaigns/:id/fund` `{promoCode?}` — debits wallet, opens escrow
- `POST /campaigns/:id/cancel`, `POST /campaigns/:id/complete`

**Applications**
- `POST /campaigns/:id/applications` `{message, proposedRate}`
- `GET /campaigns/:id/applications`, `GET /campaigns/mine/applications`
- `POST /campaigns/applications/:appId/decide` `{decision: ACCEPTED|REJECTED}`

**Deliverables (proof) / Disputes**
- `POST /campaigns/applications/:appId/deliverable`
- `POST /campaigns/applications/:appId/deliverable/review` `{decision: review|approved|changes|dispute, note?}`
- `POST /campaigns/applications/:appId/dispute` `{reason}`

**Reviews / Messages**
- `POST/GET /campaigns/applications/:appId/reviews`
- `GET/POST /campaigns/applications/:appId/messages`

**Wallet**
- `GET /wallet`, `GET /wallet/withdrawals`, `POST /wallet/withdrawals` `{amount}`

**Notifications / Referrals**
- `GET /notifications`, `POST /notifications/read`
- `GET /referrals/mine`

**Admin** (all require role `ADMIN`)
- `GET /admin/overview`, `GET/POST /admin/users/:id/{suspend,verify}`
- `GET /admin/campaigns`, `POST /admin/campaigns/:id/approve`
- `GET /admin/withdrawals`, `POST /admin/withdrawals/:id/resolve`
- `GET /admin/disputes`, `POST /admin/disputes/:id/resolve`
- `GET /admin/transactions`, `GET /admin/analytics`
- `GET/PUT /admin/settings`, categories/platforms/promo-codes CRUD
- `GET /admin/audit-logs`

## 4. Environment variables

**`server/.env`**
```
DATABASE_URL="postgres://socialboost:socialboost@localhost:5432/socialboost_dev"
PGSSL=disable                       # disable|require|verify-full — disable for local, no-TLS Postgres
JWT_SECRET="change-me"              # MUST be replaced with a long random secret in production
JWT_EXPIRES_IN="7d"
PORT=4000
CORS_ORIGIN="http://localhost:5173" # your frontend origin
NODE_ENV=development
SEED_ADMIN_EMAIL=admin@socialboost.market   # optional, used by seed.js
SEED_ADMIN_PASSWORD=ChangeMe123!            # optional, used by seed.js — change immediately
```

**`web/.env`**
```
VITE_API_URL=http://localhost:4000/api
```

## 5. Remaining production integrations

These are the explicit "connect next" points — the architecture is shaped around them but they are not wired up:

1. **Real payment provider — Stripe is now implemented, but payouts need one more piece.** `src/services/paymentProvider/stripeProvider.js` implements payment intents, webhook verification, and refunds against Stripe's real REST API — set `PAYMENT_PROVIDER=stripe` plus real `PAYMENT_SECRET_KEY`/`PAYMENT_WEBHOOK_SECRET`/`PAYMENT_PUBLIC_KEY` and it's live. Creator **payouts** are the one part that needs more than a key: Stripe can only pay a third party (a creator) through a *Connect* connected account, which requires its own onboarding flow (create the account, send the creator through an Account Link, listen for `account.updated`). That flow isn't built yet — `createPayout` fails with a clear, actionable error for any creator who hasn't completed it, rather than pretending to send money. See §6.1 below.
2. **Social account OAuth — architecture done, needs real developer credentials.** See §6 below for the full breakdown; this is now built (adapters, encryption, DB schema, routes, UI), but every platform's `*_CLIENT_ID`/`*_CLIENT_SECRET` is a blank placeholder in `.env.example` until you register real developer apps with Google, TikTok, and Meta.
3. **File storage.** Deliverable screenshots currently accept a URL string (`screenshotUrl`); wire actual upload to S3/Cloudflare R2 and store the resulting URL.
4. **Email delivery.** Notifications are in-app only; add a transactional email provider (Postmark/SES) triggered from `notificationService.notify`.
5. **Rate limiting / abuse controls** are basic (`express-rate-limit` in-memory); move to a Redis-backed limiter for multi-instance deployments.
6. **Secrets management.** `.env` files are for local dev only — use a real secrets manager in production and rotate `JWT_SECRET` and `SOCIAL_TOKEN_ENCRYPTION_KEY`.

## 6. Social account OAuth architecture (this pass)

Real OAuth-based platform verification, replacing "trust whatever the creator typed in." As with the Postgres migration, **this environment had no network access** — nothing below was executed against a real Google/TikTok/Meta app or a real Postgres instance. Code was hand-reviewed against each platform's current published API docs (checked live while writing it — Instagram in particular changed its OAuth flow twice since 2024 and the old Basic Display API is fully dead), not run end-to-end.

**Files created:**
- `migrations/0002_social_oauth.sql` — extends `social_accounts` with OAuth fields (see §2 below), adds `oauth_states` (CSRF), adds `campaigns.creator_min_followers/creator_min_engagement_bps/creator_required_country`.
- `src/utils/crypto.js` — AES-256-GCM token encryption. **Actually executed and verified in this sandbox** (no DB needed): encrypt→decrypt round-trips correctly, invalid/missing keys are rejected with a clear error, both confirmed by running the code, not just reading it.
- `src/services/oauthStateService.js` — issues and single-use-validates CSRF state tokens.
- `src/services/socialProviders/{index,errors,youtube,tiktok,instagram,facebook}.js` — one adapter per platform behind a consistent interface (`getAuthorizationUrl`, `handleCallback`, `getProfile`, `getMetrics`, `refreshToken`, `revoke`); loaded and interface-checked in this sandbox (no real HTTP calls attempted).
- `src/services/socialAccountService.js` — connect/callback/disconnect/sync/eligibility orchestration; the only code that ever decrypts a token.
- `src/routes/socialAccounts.js` — `GET /`, `GET /:platform/connect`, `GET /:platform/callback`, `POST /:id/sync`, `DELETE /:id`.
- `test/socialAccounts.test.js` — 20 tests using an injected fake adapter (no real network needed) covering state validation, callback success/failure, refresh success/failure, disconnect, cross-user access, duplicate prevention, metric sync, and eligibility. **Authored, not run** (same DB-access constraint as the payments test suite).

**Files modified:**
- `routes/campaigns.js` — new `creatorMinFollowers`/`creatorMinEngagementPercent`/`creatorRequiredCountry` campaign fields; the application endpoint now calls `socialAccountService.evaluateEligibility()` and rejects (403, with reasons) a creator who doesn't meet them — evaluated entirely from verified DB data, never from the request body. **Backward compatible**: a campaign with no eligibility fields set skips this check entirely, so existing self-report-only creators are unaffected.
- `routes/users.js` — `serializeSocial()` now also returns the OAuth fields (verification status, verified follower count, last synced, etc.) for every consumer of that shape (`/me/account`, `/me/social-accounts`, `/:id/public-profile`, `/creators`); the marketplace's follower aggregation now prefers a verified count over a self-reported one when both exist.
- `middleware`/`server.js`/`productionCheck.js` — require `SOCIAL_TOKEN_ENCRYPTION_KEY` (32 bytes) in production; **tested end-to-end in this sandbox** with a fabricated `.env` (valid config passes with warnings for unconfigured platforms; an invalid encryption key is correctly rejected — both actually run, not assumed).
- `app.js` — mounts the new router at `/api/social-accounts`.
- `.env`, `.env.example`, `docker-compose.yml` — new variables (below); the docker-compose and local `.env` values are real, working 32-byte keys generated and round-trip-tested in this sandbox, not placeholders.
- `web/src/api.js`, `AccountSettings.jsx`, `Dashboard.jsx`, `App.jsx` — new "Connected platforms" panel in Settings → Social platforms (Connect/Reconnect/Sync/Disconnect per platform, verified badges, "Metrics unavailable" / "Last synced" states), OAuth callback landing handled via a `/settings?social=connected|error` redirect. **Not syntax-checkable in this sandbox** (no JSX-capable tool available without network) — reviewed manually rather than machine-verified, unlike the `.js` files above.

**`social_accounts` new columns:** `platform_user_id`, `username`, `display_name`, `profile_image_url`, `access_token_encrypted`, `refresh_token_encrypted`, `token_expires_at`, `scopes`, `connected_via` (`SELF_REPORTED`|`OAUTH`), `verification_status` (`NOT_CONNECTED`|`CONNECTING`|`CONNECTED`|`VERIFIED`|`EXPIRED`|`REVOKED`|`ERROR`), `last_verified_at`, `following_count`, `media_count`, `engagement_metrics`, `last_synced_at`, `last_sync_error`. A partial unique index enforces one active OAuth connection per user+platform. Old self-reported rows are untouched.

**OAuth endpoints:** `GET /api/social-accounts` (list mine), `GET /api/social-accounts/:platform/connect` (Bearer-authenticated, returns an authorization URL), `GET /api/social-accounts/:platform/callback` (hit by the provider's redirect — unauthenticated in the Bearer sense by necessity; identity comes from the single-use state row instead, see the comments in `oauthStateService.js` for why), `POST /api/social-accounts/:id/sync`, `DELETE /api/social-accounts/:id`.

**Environment variables:** `SOCIAL_TOKEN_ENCRYPTION_KEY`, `FRONTEND_URL`, and per platform `{PLATFORM}_CLIENT_ID`/`{PLATFORM}_CLIENT_SECRET`/`{PLATFORM}_REDIRECT_URI` (TikTok uses `TIKTOK_CLIENT_KEY` instead of `_CLIENT_ID`, matching TikTok's own naming) — see `.env.example`.

**Security implementation:** tokens are AES-256-GCM encrypted at rest and never appear in any API response or log line; OAuth state is single-use, expiring (10 min), platform-scoped, and tied to the user who initiated it — closing CSRF, callback injection, code/state reuse, and account-linking attacks; every social-account route requires auth and checks row ownership (`Not your social account`, verified by a dedicated cross-user-access test); disconnect wipes token columns immediately (keeping the row for campaign-history integrity) and best-effort-revokes at the provider; a refresh failure marks the connection `EXPIRED` once rather than retrying forever.

**Platform readiness:** all four adapters (YouTube, TikTok, Instagram, Facebook) are code-complete against each platform's currently published OAuth/API docs. **None are live** — every `*_CLIENT_ID`/`*_CLIENT_SECRET` is blank, so every "Connect" button will correctly show a configuration error until real developer app credentials are registered with each platform and added to `.env`. Facebook access tokens have no refresh grant (users must reconnect after ~60 days); Instagram refreshes the same long-lived token in place (no separate refresh token); YouTube and TikTok both support real refresh tokens.

**Developer credentials still required, per platform:** Google Cloud project with YouTube Data API v3 enabled + OAuth consent screen + Web client (`YOUTUBE_CLIENT_ID/SECRET`); TikTok developer app with Login Kit approved, and `user.info.stats` scope specifically requires additional app review beyond basic approval (`TIKTOK_CLIENT_KEY/SECRET`); Meta developer app with "Instagram API with Instagram Login" (Business Login) product added — requires the creator's Instagram account to be Creator/Business, not personal (`INSTAGRAM_CLIENT_ID/SECRET`); Meta developer app with Facebook Login, `pages_show_list`+`pages_read_engagement` scopes approved — operates on a Page the user manages, not their personal profile (`FACEBOOK_CLIENT_ID/SECRET`).

**Next step for the real payment gateway** — done for funding/refunds this pass (see §6.1 below); Connect onboarding for payouts is the remaining piece.

## 6.1 Stripe payment provider (this pass)

**Files created:** `src/services/paymentProvider/stripeProvider.js`, `migrations/0003_stripe_connect.sql` (adds `wallets.stripe_connected_account_id`/`stripe_payouts_enabled`), `test/stripeProvider.test.js`.
**Files modified:** `paymentProvider/index.js` (registers `stripe`), `.env.example`; and a real bug fix — `paymentGatewayService.js`, `paymentService.js`, `withdrawalService.js` were calling `provider.createPaymentIntent/verifyWebhookSignature/createRefund/createPayout` **without `await`**. That was invisible with the synchronous mock provider, but would have silently broken (working with an unresolved Promise instead of the real result) the moment a real, network-calling adapter like this one was plugged in. Fixed at all 5 call sites.

**What actually ran and passed in this sandbox:** `test/stripeProvider.test.js` — 7 tests, pure crypto, no DB or network needed, executed with `node --test` and all 7 passed. This is the one test suite in this entire project that was verified end-to-end rather than just authored and syntax-checked, and it covers the single most security-critical piece of any payment integration (webhook signature forgery/replay/tampering resistance).

**What's implemented but unverified (needs a real Stripe test-mode key + network to check):** `createPaymentIntent` and `createRefund`, both plain REST calls against `api.stripe.com`.

**What's intentionally incomplete:** `createPayout` requires a creator to have a Stripe Connect connected account (`wallets.stripe_connected_account_id`) — that onboarding flow (an endpoint to create the account + Account Link, a "Set up payouts" button in Creator settings, and an `account.updated` webhook handler) is real follow-up work, not built in this pass. Until it exists, every payout attempt fails with a clear 409 rather than silently doing nothing or crashing.

## 6.2 Stripe Connect payout onboarding (this pass)

The "real follow-up work" mentioned just above is now built: `src/services/stripeConnectService.js` (create the connected account once per creator, issue a fresh onboarding link each time, and react to Stripe's `account.updated` webhook — the only signal treated as authoritative for "onboarding actually finished"), two new `stripeProvider.js` functions (`createConnectedAccount`, `createAccountLink`), `migrations/0003_stripe_connect.sql`'s columns are now actually used, two new routes (`GET /api/wallet/payouts/status`, `POST /api/wallet/payouts/onboarding`), `account.updated` dispatch added to the webhook handler, `test/stripeConnect.test.js` (6 tests, authored, needs Postgres to run), and a `PayoutSetupCard` in the Creator Earnings tab (`CreatorDashboard.jsx`) with a matching redirect landing handled in `App.jsx`.

Same verification status as everything else Stripe-related: not run against a real Stripe account. `createPayout` will now succeed once a creator's `stripe_payouts_enabled` flag is true (set by the webhook) instead of just refusing outright — but that whole path still needs the `stripe listen` walkthrough in PRODUCTION_READINESS.md to actually confirm.

## 7. How to run it

**Backend, with Docker (recommended for local dev):**
```bash
cd server
docker compose up -d postgres   # starts Postgres only; wait for it to report healthy
npm install
npm run migrate                 # applies migrations/0001_init.sql
npm run seed                    # creates admin user + labeled demo accounts (dev only)
npm run dev                     # starts on http://localhost:4000
```

**Backend, without Docker** (point `DATABASE_URL` at any Postgres 13+ instance you already have running):
```bash
cd server
npm install
npm run migrate
npm run seed
npm run dev
```

**Frontend** (separate terminal):
```bash
cd web
npm install
npm run dev               # starts on http://localhost:5173
```

Open `http://localhost:5173`. Register an advertiser and a creator account to try the flow, or log in as one of the seeded demo accounts (`advertiser@seed.socialboost.local` / `creator@seed.socialboost.local`, password `DemoPass123!`). To fund a campaign without a real payment provider connected, use the test-mode webhook simulator (`POST /api/payments/test/simulate`) or credit a wallet directly for testing:

```bash
cd server
node -e "require('./src/services/walletService').credit('<USER_ID>', 50000, 'ADMIN_ADJUSTMENT', {type:'Manual',id:null}).then(()=>process.exit(0));"
```

Admin login: `admin@socialboost.market` / `ChangeMe123!` (change immediately — see `SEED_ADMIN_PASSWORD` above).

## 8. PostgreSQL migration — status, commands, and what's unverified

The backend was migrated from a `node:sqlite` runtime to PostgreSQL (via the `pg` driver — no ORM at runtime). See `PRODUCTION_READINESS.md` for the full file-by-file breakdown, migration commands, and — importantly — **what has and hasn't actually been run**: the environment this migration was written in had no network access, so the code was hand-reviewed against Postgres/`pg` semantics but never executed against a live database. Run `npm test` against a disposable Postgres database before deploying.

**Common commands:**
```bash
npm run migrate           # apply pending migrations
npm run migrate:status    # show applied / pending migrations
npm run migrate:reset     # DEV ONLY — drops and recreates the schema, refuses to run when NODE_ENV=production
npm test                  # runs test/financial.test.js against DATABASE_URL (must be a disposable *test* database)
```

**Backup / restore (standard Postgres tooling — no custom scripts):**
```bash
pg_dump "$DATABASE_URL" -Fc -f backup.dump   # backup
pg_restore -d "$DATABASE_URL" --clean backup.dump   # restore
```
Take a backup before every production migration. `db/migrate.js` never runs a destructive statement automatically — a destructive schema change (dropping a column, etc.) must be its own reviewed migration file.

**Rollback:** this migration runner is forward-only by design (see `db/migrate.js` comments) — there's no auto-generated "down" migration. To roll back a bad migration in production, restore the pre-migration `pg_dump` backup rather than attempting to reverse the SQL.

## What was verified end-to-end (via curl, see conversation for full transcripts)

*(Note: this verification was performed against the original SQLite-era runtime, before the PostgreSQL migration and the social OAuth work documented in §6 and §8 above. It hasn't been re-run against Postgres — see §8's "Needs verification" list for what actually has been checked since.)*

- Funding fails with a real error when a wallet has $0 balance (no fake money).
- Non-admin tokens are rejected on `/admin/*` routes.
- Application → accept → submit proof → approve → wallet credit, with exact commission math ($200 rate, 15% commission → $30 fee / $170 net, verified in the wallet ledger).
- Duplicate reviews on the same application are rejected (409) by the DB unique constraint.
- Withdrawal request holds funds immediately; admin rejection refunds the exact amount back to the wallet.
- Every action above produced a corresponding `admin_audit_logs` row.
