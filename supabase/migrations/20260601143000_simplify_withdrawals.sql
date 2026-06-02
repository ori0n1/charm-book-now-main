ALTER TABLE public.studio_payout_settings
  ADD COLUMN IF NOT EXISTS fiscal_name text,
  ADD COLUMN IF NOT EXISTS nif text,
  ADD COLUMN IF NOT EXISTS payout_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'iban',
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS mb_way_phone text;

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS mb_way_phone text,
  ADD COLUMN IF NOT EXISTS payout_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'iban';

ALTER TABLE public.studio_payout_settings
  DROP CONSTRAINT IF EXISTS studio_payout_settings_payout_method_check,
  DROP CONSTRAINT IF EXISTS studio_payout_settings_destination_check,
  DROP CONSTRAINT IF EXISTS studio_payout_settings_check;

ALTER TABLE public.studio_payout_settings
  ADD CONSTRAINT studio_payout_settings_payout_method_check
    CHECK (payout_method IN ('iban','mb_way','stripe')),
  ADD CONSTRAINT studio_payout_settings_destination_check
    CHECK (
      (payout_method = 'iban' AND iban IS NOT NULL)
      OR (payout_method = 'mb_way' AND mb_way_phone IS NOT NULL)
      OR (payout_method = 'stripe' AND stripe_account_id IS NOT NULL)
    );

ALTER TABLE public.withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_payout_method_check,
  DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;

UPDATE public.withdrawal_requests
SET status = 'completed'
WHERE status = 'paid';

UPDATE public.withdrawal_requests
SET status = 'canceled'
WHERE status = 'rejected';

UPDATE public.withdrawal_requests
SET status = 'in_review'
WHERE status = 'pending';

ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_payout_method_check
    CHECK (payout_method IN ('iban','mb_way','stripe')),
  ADD CONSTRAINT withdrawal_requests_status_check
    CHECK (status IN ('pending','in_review','completed','failed','canceled','paid','rejected'));
