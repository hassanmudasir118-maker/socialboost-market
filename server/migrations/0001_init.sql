-- Migration 0001: initial schema
-- Converted from the SQLite runtime schema. All table/column/constraint
-- definitions below were already standard SQL and needed no changes —
-- only SQLite's PRAGMA line (foreign keys are always enforced in
-- Postgres) was removed. Applied inside a transaction by migrate.js.


CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('ADVERTISER','CREATOR','ADMIN')),
  suspended      INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_suspended ON users(suspended);

CREATE TABLE IF NOT EXISTS profiles (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name        TEXT NOT NULL,
  username            TEXT UNIQUE,
  bio                 TEXT,
  avatar_url          TEXT,
  country             TEXT,
  languages           TEXT NOT NULL DEFAULT '[]',
  categories          TEXT NOT NULL DEFAULT '[]',
  referral_code       TEXT UNIQUE,
  verified            INTEGER NOT NULL DEFAULT 0,
  rating_avg          REAL NOT NULL DEFAULT 0,
  rating_count        INTEGER NOT NULL DEFAULT 0,
  completed_campaigns INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_country ON profiles(country);
CREATE INDEX IF NOT EXISTS idx_profiles_verified ON profiles(verified);

CREATE TABLE IF NOT EXISTS social_accounts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('YOUTUBE','TIKTOK','INSTAGRAM','FACEBOOK','OTHER')),
  handle          TEXT NOT NULL,
  profile_url     TEXT NOT NULL,
  followers       INTEGER NOT NULL DEFAULT 0,
  engagement_rate REAL NOT NULL DEFAULT 0,
  verified_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_user ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_platform ON social_accounts(platform);

CREATE TABLE IF NOT EXISTS campaigns (
  id                       TEXT PRIMARY KEY,
  advertiser_id            TEXT NOT NULL REFERENCES users(id),
  title                    TEXT NOT NULL,
  description              TEXT NOT NULL,
  platform                 TEXT NOT NULL CHECK (platform IN ('YOUTUBE','TIKTOK','INSTAGRAM','FACEBOOK','OTHER')),
  content_url              TEXT NOT NULL,
  category                 TEXT NOT NULL,
  campaign_type            TEXT NOT NULL,
  requirements             TEXT NOT NULL,
  eligibility_requirements TEXT,
  target_country           TEXT,
  audience_age_min         INTEGER,
  audience_age_max         INTEGER,
  audience_gender          TEXT,
  audience_locations       TEXT NOT NULL DEFAULT '[]',
  audience_interests       TEXT NOT NULL DEFAULT '[]',
  budget_cents             INTEGER NOT NULL CHECK (budget_cents > 0),
  budget_per_creator_cents INTEGER NOT NULL CHECK (budget_per_creator_cents > 0),
  commission_bps           INTEGER NOT NULL,
  max_creators             INTEGER NOT NULL CHECK (max_creators > 0),
  start_date               TEXT NOT NULL,
  end_date                 TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN (
                               'DRAFT','PENDING_PAYMENT','FUNDED','PUBLISHED','IN_PROGRESS',
                               'SUBMITTED','UNDER_REVIEW','COMPLETED','CANCELLED','DISPUTED'
                             )),
  admin_approved           INTEGER NOT NULL DEFAULT 0,
  promo_code               TEXT,
  funded_at                TEXT,
  published_at             TEXT,
  completed_at             TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser ON campaigns(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_platform ON campaigns(platform);
CREATE INDEX IF NOT EXISTS idx_campaigns_category ON campaigns(category);
CREATE INDEX IF NOT EXISTS idx_campaigns_country ON campaigns(target_country);
CREATE INDEX IF NOT EXISTS idx_campaigns_end_date ON campaigns(end_date);

-- Itemized, discrete requirement/eligibility lines shown as a checklist in
-- the marketplace and application flow (separate from the free-text description).
CREATE TABLE IF NOT EXISTS campaign_requirements (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  requirement_text TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirements_campaign ON campaign_requirements(campaign_id);

-- Every campaign status transition, who made it, and why — the audit trail
-- required by §2. Written only by server-side status-transition code, never
-- by a direct client-supplied status value.
CREATE TABLE IF NOT EXISTS campaign_status_history (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  changed_by_user_id TEXT REFERENCES users(id),
  note           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_history_campaign ON campaign_status_history(campaign_id);
CREATE INDEX IF NOT EXISTS idx_status_history_created ON campaign_status_history(created_at);

CREATE TABLE IF NOT EXISTS campaign_applications (
  id                       TEXT PRIMARY KEY,
  campaign_id              TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  creator_id               TEXT NOT NULL REFERENCES users(id),
  message                  TEXT NOT NULL,
  proposed_rate_cents      INTEGER NOT NULL CHECK (proposed_rate_cents > 0),
  estimated_completion_days INTEGER,
  relevant_experience      TEXT,
  social_account_id        TEXT REFERENCES social_accounts(id),
  supporting_info          TEXT,
  status                   TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','WITHDRAWN')),
  info_requested_at        TEXT,
  info_requested_note      TEXT,
  applied_at                TEXT NOT NULL,
  decided_at                TEXT,
  UNIQUE (campaign_id, creator_id)
);
CREATE INDEX IF NOT EXISTS idx_apps_campaign ON campaign_applications(campaign_id);
CREATE INDEX IF NOT EXISTS idx_apps_creator ON campaign_applications(creator_id);
CREATE INDEX IF NOT EXISTS idx_apps_status ON campaign_applications(status);

-- The "contract" formed once an application is accepted — deliberately
-- separate from CampaignApplication so accept/reject history and the actual
-- working engagement (which can later be cancelled independently, e.g. if a
-- creator goes unresponsive) are not the same record.
CREATE TABLE IF NOT EXISTS campaign_assignments (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL UNIQUE REFERENCES campaign_applications(id) ON DELETE CASCADE,
  creator_id     TEXT NOT NULL REFERENCES users(id),
  advertiser_id  TEXT NOT NULL REFERENCES users(id),
  agreed_rate_cents INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','COMPLETED')),
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignments_campaign ON campaign_assignments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_assignments_creator ON campaign_assignments(creator_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON campaign_assignments(status);

-- One header row per assignment, tracking the CURRENT review state.
-- The actual submitted content lives in deliverable_versions below — every
-- submission (including resubmissions after a revision request) is kept.
CREATE TABLE IF NOT EXISTS campaign_deliverables (
  id             TEXT PRIMARY KEY,
  assignment_id  TEXT NOT NULL UNIQUE REFERENCES campaign_assignments(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'SUBMITTED'
                   CHECK (status IN ('SUBMITTED','REVISION_REQUESTED','APPROVED','REJECTED','DISPUTED')),
  current_version INTEGER NOT NULL DEFAULT 1,
  review_note    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliverables_status ON campaign_deliverables(status);

CREATE TABLE IF NOT EXISTS deliverable_versions (
  id              TEXT PRIMARY KEY,
  deliverable_id  TEXT NOT NULL REFERENCES campaign_deliverables(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  content_url     TEXT,
  promotion_url   TEXT,
  screenshot_url  TEXT,
  notes           TEXT,
  completion_date TEXT,
  submitted_at    TEXT NOT NULL,
  UNIQUE (deliverable_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_versions_deliverable ON deliverable_versions(deliverable_id);

CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES campaign_applications(id) ON DELETE CASCADE,
  from_user_id   TEXT NOT NULL REFERENCES users(id),
  to_user_id     TEXT NOT NULL REFERENCES users(id),
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text           TEXT,
  verified       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  UNIQUE (application_id, from_user_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_to ON reviews(to_user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_campaign ON reviews(campaign_id);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES campaign_applications(id) ON DELETE CASCADE,
  from_user_id   TEXT NOT NULL REFERENCES users(id),
  text           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_app ON messages(application_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notifications(user_id, read);

-- Provider-facing payment intents. Separate from `transactions` (our internal
-- ledger of completed money movements) on purpose: a payment can exist here
-- in PENDING/PROCESSING/FAILED state without ever becoming a ledger entry —
-- exactly like a Stripe PaymentIntent vs. a completed charge.
-- NOTE: this table must be created before `transactions`, which has a
-- foreign key into it (Postgres rejects a FK referencing a table that does
-- not exist yet — unlike SQLite, which doesn't enforce that at creation
-- time, so this ordering bug only shows up once run against real Postgres).
CREATE TABLE IF NOT EXISTS payments (
  id                    TEXT PRIMARY KEY,
  campaign_id           TEXT REFERENCES campaigns(id),
  user_id               TEXT NOT NULL REFERENCES users(id),
  provider              TEXT NOT NULL,
  provider_payment_id   TEXT UNIQUE,
  provider_customer_id  TEXT,
  amount_cents          INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'usd',
  platform_fee_cents    INTEGER NOT NULL DEFAULT 0,
  creator_allocation_cents INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  test_mode             INTEGER NOT NULL DEFAULT 1,
  idempotency_key       TEXT UNIQUE,
  failure_reason        TEXT,
  refunded_cents        INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_campaign ON payments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_id ON payments(provider_payment_id);

CREATE TABLE IF NOT EXISTS transactions (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL CHECK (type IN ('CAMPAIGN_FUNDING','CREATOR_PAYOUT','WITHDRAWAL','REFUND','ADJUSTMENT')),
  status             TEXT NOT NULL CHECK (status IN ('HELD_IN_ESCROW','RELEASED','COMPLETED','PENDING','PROCESSING','REJECTED','REFUNDED','FAILED')),
  user_id            TEXT REFERENCES users(id),
  campaign_id        TEXT REFERENCES campaigns(id),
  application_id     TEXT REFERENCES campaign_applications(id),
  payment_id         TEXT REFERENCES payments(id),
  amount_cents       INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  net_cents          INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'usd',
  idempotency_key    TEXT UNIQUE,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_campaign ON transactions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_txn_payment ON transactions(payment_id);

-- Idempotency + dedup store for provider webhook events. provider_event_id is
-- UNIQUE so the exact same event can never be applied twice, regardless of
-- how many times the provider retries delivery.
CREATE TABLE IF NOT EXISTS webhook_events (
  id                  TEXT PRIMARY KEY,
  provider            TEXT NOT NULL,
  provider_event_id   TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  payment_id          TEXT REFERENCES payments(id),
  payload             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSED','FAILED','IGNORED')),
  error                TEXT,
  received_at         TEXT NOT NULL,
  processed_at        TEXT,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_provider_event ON webhook_events(provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_payment ON webhook_events(payment_id);

-- Authoritative per-campaign escrow ledger. Every cents figure here is
-- derived and checked server-side only; nothing here is ever taken from a
-- client request body.
CREATE TABLE IF NOT EXISTS campaign_escrow (
  campaign_id      TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  funded_cents     INTEGER NOT NULL DEFAULT 0,
  reserved_cents   INTEGER NOT NULL DEFAULT 0,
  released_cents   INTEGER NOT NULL DEFAULT 0,
  refunded_cents   INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL,
  CHECK (funded_cents >= 0 AND reserved_cents >= 0 AND released_cents >= 0 AND refunded_cents >= 0)
);

CREATE TABLE IF NOT EXISTS wallets (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_cents       INTEGER NOT NULL DEFAULT 0,
  pending_cents       INTEGER NOT NULL DEFAULT 0,
  total_earned_cents  INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                   TEXT PRIMARY KEY,
  wallet_id            TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  direction            TEXT NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
  reason               TEXT NOT NULL CHECK (reason IN ('CAMPAIGN_PAYOUT','CAMPAIGN_FUNDING_DEBIT','CAMPAIGN_REFUND','WITHDRAWAL_REQUEST','WITHDRAWAL_REJECTED_REFUND','DISPUTE_RESOLUTION','ADMIN_ADJUSTMENT','REFERRAL_BONUS')),
  amount_cents         INTEGER NOT NULL,
  balance_after_cents  INTEGER NOT NULL,
  reference_type       TEXT,
  reference_id         TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON wallet_ledger(wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_reason ON wallet_ledger(reason);

CREATE TABLE IF NOT EXISTS withdrawals (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  transaction_id     TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  amount_cents       INTEGER NOT NULL,
  fee_cents          INTEGER NOT NULL,
  net_cents          INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  payout_provider    TEXT,
  payout_provider_id TEXT,
  payout_status      TEXT NOT NULL DEFAULT 'NOT_STARTED'
                       CHECK (payout_status IN ('NOT_STARTED','PENDING','PROCESSING','COMPLETED','FAILED')),
  payout_failure_reason TEXT,
  payout_retry_count INTEGER NOT NULL DEFAULT 0,
  requested_at       TEXT NOT NULL,
  decided_at         TEXT,
  decided_by_user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_payout_status ON withdrawals(payout_status);

CREATE TABLE IF NOT EXISTS disputes (
  id                  TEXT PRIMARY KEY,
  campaign_id         TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  application_id      TEXT NOT NULL REFERENCES campaign_applications(id) ON DELETE CASCADE,
  raised_by_user_id   TEXT NOT NULL REFERENCES users(id),
  raised_by_role      TEXT NOT NULL CHECK (raised_by_role IN ('ADVERTISER','CREATOR')),
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution          TEXT CHECK (resolution IN ('RELEASED_TO_CREATOR','REFUNDED_TO_ADVERTISER')),
  resolved_by_user_id TEXT,
  resolved_at         TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_campaign ON disputes(campaign_id);

CREATE TABLE IF NOT EXISTS referrals (
  id               TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES users(id),
  referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);

CREATE TABLE IF NOT EXISTS platform_settings (
  id                          TEXT PRIMARY KEY DEFAULT 'singleton',
  commission_bps              INTEGER NOT NULL DEFAULT 1500,
  min_withdrawal_cents        INTEGER NOT NULL DEFAULT 5000,
  max_withdrawal_cents        INTEGER NOT NULL DEFAULT 500000,
  processing_fee_bps          INTEGER NOT NULL DEFAULT 250,
  processing_fee_fixed_cents  INTEGER NOT NULL DEFAULT 30,
  categories                  TEXT NOT NULL DEFAULT '[]',
  platforms                   TEXT NOT NULL DEFAULT '[]',
  updated_at                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  discount_bps INTEGER NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  uses         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),
  actor_role  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  campaign_id TEXT REFERENCES campaigns(id),
  details     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at);

-- ---------------------------------------------------------------------------
-- Auth: password reset, email verification, revocable sessions
-- ---------------------------------------------------------------------------

-- Tokens are never stored raw — only a SHA-256 hash, so a DB leak alone can't
-- be used to reset anyone's password or verify an email that isn't theirs.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_hash ON password_reset_tokens(token_hash);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_hash ON email_verification_tokens(token_hash);

-- Backs refresh tokens (revocable, unlike the short-lived access JWT) and
-- doubles as the account's login/activity history for the user and for admins.
CREATE TABLE IF NOT EXISTS user_sessions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  user_agent          TEXT,
  ip_address          TEXT,
  expires_at          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  last_used_at        TEXT NOT NULL,
  revoked_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON user_sessions(refresh_token_hash);
