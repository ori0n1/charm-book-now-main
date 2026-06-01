CREATE TABLE IF NOT EXISTS public.studio_payout_settings (
  studio_id uuid PRIMARY KEY REFERENCES public.studios(id) ON DELETE CASCADE,
  fiscal_name text NOT NULL,
  nif text NOT NULL,
  payout_mode text NOT NULL DEFAULT 'manual'
    CHECK (payout_mode IN ('manual','stripe_automatic')),
  payout_method text NOT NULL DEFAULT 'iban'
    CHECK (payout_method IN ('iban','mb_way','stripe')),
  iban text,
  mb_way_phone text,
  stripe_account_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (payout_method = 'iban' AND iban IS NOT NULL)
    OR (payout_method = 'mb_way' AND mb_way_phone IS NOT NULL)
    OR (payout_method = 'stripe' AND stripe_account_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_review','completed','failed','canceled','paid','rejected')),
  payout_mode text NOT NULL CHECK (payout_mode IN ('manual','stripe_automatic')),
  payout_method text NOT NULL CHECK (payout_method IN ('iban','mb_way','stripe')),
  fiscal_name text NOT NULL,
  nif text NOT NULL,
  iban_last4 text,
  mb_way_phone text,
  stripe_account_id text,
  stripe_transfer_id text,
  admin_notes text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_studio_requested
  ON public.withdrawal_requests(studio_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status
  ON public.withdrawal_requests(status, requested_at DESC);

DROP TRIGGER IF EXISTS trg_studio_payout_settings_updated_at ON public.studio_payout_settings;
CREATE TRIGGER trg_studio_payout_settings_updated_at
  BEFORE UPDATE ON public.studio_payout_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_withdrawal_requests_updated_at ON public.withdrawal_requests;
CREATE TRIGGER trg_withdrawal_requests_updated_at
  BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.studio_payout_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage payout settings" ON public.studio_payout_settings;
CREATE POLICY "Owners manage payout settings" ON public.studio_payout_settings
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members read withdrawal requests" ON public.withdrawal_requests;
CREATE POLICY "Members read withdrawal requests" ON public.withdrawal_requests
  FOR SELECT TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'studio_notifications_kind_check'
      AND conrelid = 'public.studio_notifications'::regclass
  ) THEN
    ALTER TABLE public.studio_notifications
      DROP CONSTRAINT studio_notifications_kind_check;
  END IF;

  ALTER TABLE public.studio_notifications
    ADD CONSTRAINT studio_notifications_kind_check
    CHECK (kind IN ('new_appointment','payment_confirmed','withdrawal_requested'));
END $$;
