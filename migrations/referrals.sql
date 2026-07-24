-- Migration: Sistema "Indique e Ganhe" — Bellza
-- Run in Supabase SQL Editor BEFORE deploying.
-- Safe to run multiple times (IF NOT EXISTS guards).

-- ── 1. Referral code on studios ──────────────────────────────────────────────
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

COMMENT ON COLUMN studios.referral_code IS
  'Código único de indicação (8 chars uppercase). Gerado automaticamente ao primeiro acesso.';

-- ── 2. Referrals table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_studio_id  UUID        NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  referred_studio_id  UUID        NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  ref_code            TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending_validation',
  -- status: pending_validation | approved | rejected
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  subscription_started_at TIMESTAMPTZ,  -- when referred studio first subscribed
  validated_at        TIMESTAMPTZ,      -- when 30-day rule passed
  credited_at         TIMESTAMPTZ,      -- when credit was applied to Stripe balance
  UNIQUE(referred_studio_id)            -- each studio can only be referred once
);

COMMENT ON TABLE referrals IS
  'Rastreia indicações entre estúdios. Uma indicação por estúdio indicado.';

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_studio_id);
CREATE INDEX IF NOT EXISTS idx_referrals_ref_code  ON referrals(ref_code);
CREATE INDEX IF NOT EXISTS idx_referrals_status    ON referrals(status);

-- ── 3. Referral credits table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_credits (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  studio_id     UUID        NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  referral_id   UUID        REFERENCES referrals(id) ON DELETE SET NULL,
  amount_cents  INTEGER     NOT NULL DEFAULT 899,  -- 8.99 €
  status        TEXT        NOT NULL DEFAULT 'available',
  -- status: available | applied | expired
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  applied_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ DEFAULT (now() + INTERVAL '6 months') NOT NULL
);

COMMENT ON TABLE referral_credits IS
  'Créditos Bellza acumulados por indicações aprovadas. Máximo 6 créditos por estúdio (fase inicial).';

CREATE INDEX IF NOT EXISTS idx_referral_credits_studio  ON referral_credits(studio_id);
CREATE INDEX IF NOT EXISTS idx_referral_credits_status  ON referral_credits(status);
CREATE INDEX IF NOT EXISTS idx_referral_credits_expires ON referral_credits(expires_at)
  WHERE status = 'available';

-- ── 4. Constraints / checks ───────────────────────────────────────────────────
ALTER TABLE referrals
  DROP CONSTRAINT IF EXISTS referrals_no_self_referral;
ALTER TABLE referrals
  ADD CONSTRAINT referrals_no_self_referral
  CHECK (referrer_studio_id <> referred_studio_id);

ALTER TABLE referral_credits
  DROP CONSTRAINT IF EXISTS referral_credits_positive_amount;
ALTER TABLE referral_credits
  ADD CONSTRAINT referral_credits_positive_amount
  CHECK (amount_cents > 0);

ALTER TABLE referrals
  DROP CONSTRAINT IF EXISTS referrals_valid_status;
ALTER TABLE referrals
  ADD CONSTRAINT referrals_valid_status
  CHECK (status IN ('pending_validation', 'approved', 'rejected'));

ALTER TABLE referral_credits
  DROP CONSTRAINT IF EXISTS referral_credits_valid_status;
ALTER TABLE referral_credits
  ADD CONSTRAINT referral_credits_valid_status
  CHECK (status IN ('available', 'applied', 'expired'));
