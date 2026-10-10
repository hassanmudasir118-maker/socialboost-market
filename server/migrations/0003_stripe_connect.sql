-- Migration 0003: Stripe Connect fields for real creator payouts.
--
-- Real money OUT to a creator (as opposed to money IN from an advertiser)
-- requires the creator to have their own Stripe Connect account — Stripe's
-- Payouts API only sends money to your OWN bank account; sending to a third
-- party (a creator) requires Connect: a Transfer into their connected
-- account's balance, which Stripe then pays out to their bank on its own
-- schedule (see stripeProvider.js for the full explanation and links).
--
-- This migration only adds the column needed to record that a creator has
-- completed Connect onboarding. It does NOT implement the onboarding flow
-- itself (an "Account Link" the creator visits to enter their bank details
-- with Stripe directly) — that is real, separate follow-up work: an
-- endpoint to create the account + onboarding link, a frontend "Set up
-- payouts" button, and a webhook handler for account.updated to know when
-- onboarding actually finished. See PRODUCTION_READINESS.md.

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS stripe_connected_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled       INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_stripe_account ON wallets(stripe_connected_account_id) WHERE stripe_connected_account_id IS NOT NULL;
