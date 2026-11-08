-- Quick tasks: an advertiser buys a number of follows / likes / subscribes
-- for a profile or video; creators do them one by one and earn a small reward.

ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check CHECK (reason IN (
  'CAMPAIGN_PAYOUT','CAMPAIGN_FUNDING_DEBIT','CAMPAIGN_REFUND','WITHDRAWAL_REQUEST',
  'WITHDRAWAL_REJECTED_REFUND','DISPUTE_RESOLUTION','ADMIN_ADJUSTMENT','REFERRAL_BONUS','TASK_REWARD'));

CREATE TABLE IF NOT EXISTS task_orders (
  id                 TEXT PRIMARY KEY,
  advertiser_id      TEXT NOT NULL REFERENCES users(id),
  platform           TEXT NOT NULL,
  action             TEXT NOT NULL,
  target_url         TEXT NOT NULL,
  target_name        TEXT,
  quantity           INTEGER NOT NULL,
  price_per_cents    INTEGER NOT NULL,
  reward_per_cents   INTEGER NOT NULL,
  total_cents        INTEGER NOT NULL,
  done_count         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  payment_method     TEXT,
  payment_reference  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_orders_status ON task_orders(status);
CREATE INDEX IF NOT EXISTS idx_task_orders_adv ON task_orders(advertiser_id);

CREATE TABLE IF NOT EXISTS task_claims (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES task_orders(id),
  creator_id        TEXT NOT NULL REFERENCES users(id),
  creator_username  TEXT,
  status            TEXT NOT NULL DEFAULT 'STARTED',
  reward_cents      INTEGER NOT NULL DEFAULT 0,
  started_at        TEXT NOT NULL,
  claimed_at        TEXT,
  resolved_at       TEXT,
  note              TEXT,
  UNIQUE (order_id, creator_id)
);
CREATE INDEX IF NOT EXISTS idx_task_claims_order ON task_claims(order_id, status);
CREATE INDEX IF NOT EXISTS idx_task_claims_creator ON task_claims(creator_id);
