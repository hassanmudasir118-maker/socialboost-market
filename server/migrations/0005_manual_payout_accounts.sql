-- Creator payout account for manual (human-sent) withdrawals (EasyPaisa / JazzCash).
-- Stored on the profile (entered once) and snapshotted onto each withdrawal at
-- request time so a later profile edit never changes where a requested payout goes.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payout_method TEXT
  CHECK (payout_method IS NULL OR payout_method IN ('EASYPAISA', 'JAZZCASH'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payout_account_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payout_account_number TEXT;

ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_account_method TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_account_name TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_account_number TEXT;
