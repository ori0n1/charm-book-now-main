-- Migration: Add Stripe Connect Express columns to studios table
-- Run this in Supabase SQL editor BEFORE deploying the new code.
--
-- These columns store the Stripe Connect account state per studio.
-- Deposits from clients are routed directly to the studio's Connect account.
-- Bellza only manages platform subscriptions via its own Stripe account.

ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id        TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled   BOOLEAN     DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled   BOOLEAN     DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarding_completed BOOLEAN  DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS stripe_connect_status            TEXT        DEFAULT 'not_connected' NOT NULL;

-- Index for webhook sync (account.updated looks up by stripe_connect_account_id)
CREATE INDEX IF NOT EXISTS idx_studios_stripe_connect_account_id
  ON studios (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

-- Optional: add a comment to document the column purpose
COMMENT ON COLUMN studios.stripe_connect_account_id IS
  'Stripe Connect Express account ID (acct_...). NULL = not connected.';
COMMENT ON COLUMN studios.stripe_connect_charges_enabled IS
  'True when the Connect account can accept payments (Stripe verification complete).';
COMMENT ON COLUMN studios.stripe_connect_status IS
  'Derived status: not_connected | pending | pending_verification | active | restricted';
