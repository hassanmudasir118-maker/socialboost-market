-- Manual EasyPaisa (and other manual, human-confirmed) payment methods.
--
-- Real EasyPaisa/JazzCash *merchant* API access requires a registered
-- business merchant account (see PRODUCTION_READINESS.md) — until that
-- exists, this adds a "manual" checkout path: the advertiser is shown the
-- platform's own EasyPaisa receiving account, sends the money themselves via
-- their EasyPaisa app, and submits a transaction reference. An admin then
-- manually confirms the money actually arrived before escrow is funded.
-- This is the exact same human-confirms-it-happened pattern already used
-- nowhere else in this codebase for funding, but mirrors how a creator
-- payout can be marked payout_provider='MANUAL' (see withdrawals).
--
-- No `payments` row is ever marked SUCCEEDED, and no escrow is ever funded,
-- purely from client-submitted data — only an authenticated admin action
-- (resolveManualPayment) can do that.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS manual_reference TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS manual_note TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS manual_review_status TEXT
  CHECK (manual_review_status IS NULL OR manual_review_status IN ('AWAITING_REFERENCE', 'PENDING_REVIEW', 'CONFIRMED', 'REJECTED'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS manual_reviewed_by TEXT REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS manual_reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_manual_review ON payments(manual_review_status);
