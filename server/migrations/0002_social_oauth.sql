-- Migration 0002: OAuth social account connections
--
-- Extends social_accounts (previously self-report-only) with the fields
-- needed for real OAuth-verified connections, and adds oauth_states for
-- CSRF-safe authorization-code flow. Existing self-reported rows are
-- untouched — they keep working exactly as before (see §1 of the OAuth
-- brief: "Do NOT remove existing functionality"), and default to
-- connected_via='SELF_REPORTED', verification_status='NOT_CONNECTED'.

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS platform_user_id       TEXT,
  ADD COLUMN IF NOT EXISTS username                TEXT,
  ADD COLUMN IF NOT EXISTS display_name            TEXT,
  ADD COLUMN IF NOT EXISTS profile_image_url       TEXT,
  ADD COLUMN IF NOT EXISTS access_token_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at        TEXT,
  ADD COLUMN IF NOT EXISTS scopes                  TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS connected_via           TEXT NOT NULL DEFAULT 'SELF_REPORTED'
    CHECK (connected_via IN ('SELF_REPORTED','OAUTH')),
  ADD COLUMN IF NOT EXISTS verification_status     TEXT NOT NULL DEFAULT 'NOT_CONNECTED'
    CHECK (verification_status IN ('NOT_CONNECTED','CONNECTING','CONNECTED','VERIFIED','EXPIRED','REVOKED','ERROR')),
  ADD COLUMN IF NOT EXISTS last_verified_at        TEXT,
  ADD COLUMN IF NOT EXISTS follower_count          INTEGER,
  ADD COLUMN IF NOT EXISTS following_count         INTEGER,
  ADD COLUMN IF NOT EXISTS media_count             INTEGER,
  ADD COLUMN IF NOT EXISTS engagement_metrics      TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at          TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_error         TEXT;

-- Backfill: any row that already has a verified_at (from the old self-report
-- flow) is left as-is — that flow never actually sets verified_at (see
-- routes/users.js), so in practice this is a no-op, but it's here in case a
-- future self-report path legitimately sets it.
UPDATE social_accounts SET verification_status = 'VERIFIED' WHERE verified_at IS NOT NULL AND verification_status = 'NOT_CONNECTED';

-- Exactly one ACTIVE OAuth connection per user+platform. Self-reported rows
-- (and OAuth rows the user has disconnected — REVOKED) are exempt, so a user
-- can reconnect a platform after disconnecting without a stale row blocking
-- them, and self-reported multi-account behavior (unrestricted today) is
-- unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_oauth_active_per_platform
  ON social_accounts(user_id, platform)
  WHERE connected_via = 'OAUTH' AND verification_status <> 'REVOKED';

CREATE INDEX IF NOT EXISTS idx_social_verification_status ON social_accounts(verification_status);
CREATE INDEX IF NOT EXISTS idx_social_platform_user_id ON social_accounts(platform, platform_user_id);

-- ---------------------------------------------------------------------------
-- OAuth CSRF state — one row per in-flight "Connect" click. The callback must
-- find an unused, unexpired row whose user_id matches the authenticated
-- session before it will touch any token (see oauthStateService.js).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_states (
  id           TEXT PRIMARY KEY,
  state_hash   TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('YOUTUBE','TIKTOK','INSTAGRAM','FACEBOOK')),
  redirect_uri TEXT NOT NULL,
  used_at      TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- ---------------------------------------------------------------------------
-- Campaign creator-eligibility requirements (§9) — distinct from the existing
-- audience_* columns, which describe the campaign's target AUDIENCE, not
-- requirements a CREATOR must meet to apply.
-- ---------------------------------------------------------------------------
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS creator_min_followers      INTEGER,
  ADD COLUMN IF NOT EXISTS creator_min_engagement_bps INTEGER,
  ADD COLUMN IF NOT EXISTS creator_required_country   TEXT;
