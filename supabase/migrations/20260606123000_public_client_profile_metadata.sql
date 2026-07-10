ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'visitor',
  ADD COLUMN IF NOT EXISTS contact_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_consent_version text,
  ADD COLUMN IF NOT EXISTS policy_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS notification_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS notification_consent_status text;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_account_kind_check,
  ADD CONSTRAINT clients_account_kind_check
    CHECK (account_kind IN ('visitor', 'account'));

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_notification_consent_status_check,
  ADD CONSTRAINT clients_notification_consent_status_check
    CHECK (
      notification_consent_status IS NULL
      OR notification_consent_status IN ('granted', 'denied', 'default')
    );

CREATE INDEX IF NOT EXISTS idx_clients_studio_email_lower
  ON public.clients(studio_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_studio_auth_user
  ON public.clients(studio_id, auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_studio_birth_month_day
  ON public.clients(
    studio_id,
    (extract(month from date_of_birth)),
    (extract(day from date_of_birth))
  )
  WHERE date_of_birth IS NOT NULL;
