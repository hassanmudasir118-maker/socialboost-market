-- Membership plans for advertisers. The one real benefit of a paid plan is a
-- lower platform commission on every campaign (commission_discount_bps).
CREATE TABLE IF NOT EXISTS membership_plans (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  price_cents              INTEGER NOT NULL DEFAULT 0,
  commission_discount_bps  INTEGER NOT NULL DEFAULT 0,
  description              TEXT,
  sort_order               INTEGER NOT NULL DEFAULT 0
);

INSERT INTO membership_plans (id, name, price_cents, commission_discount_bps, description, sort_order) VALUES
  ('FREE', 'Free', 0, 0, 'Everything you need to start. Standard platform commission.', 1),
  ('PRO', 'Pro', 150000, 500, 'Pay 5% less commission on every campaign.', 2),
  ('VIP', 'VIP', 300000, 1000, 'Pay 10% less commission on every campaign.', 3)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_plan TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_expires_at TEXT;

CREATE TABLE IF NOT EXISTS membership_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  plan_id       TEXT NOT NULL,
  payment_reference TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  created_at    TEXT NOT NULL,
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_membership_requests_status ON membership_requests(status);
