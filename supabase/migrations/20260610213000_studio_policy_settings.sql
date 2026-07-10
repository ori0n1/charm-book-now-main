ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS studio_policy_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.studios.studio_policy_settings IS
  'Structured policy settings edited from the studio compliance center. Operational payment/refund fields remain authoritative for booking flows.';
