ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS deposit_recipient text NOT NULL DEFAULT 'studio',
  ADD COLUMN IF NOT EXISTS deposit_professional_percent integer NOT NULL DEFAULT 0;

ALTER TABLE public.studios
  ADD CONSTRAINT studios_deposit_recipient_valid
  CHECK (deposit_recipient IN ('studio', 'professional', 'split'));

ALTER TABLE public.studios
  ADD CONSTRAINT studios_deposit_professional_percent_range
  CHECK (deposit_professional_percent >= 0 AND deposit_professional_percent <= 100);

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS commission_percent integer,
  ADD COLUMN IF NOT EXISTS deposit_recipient text,
  ADD COLUMN IF NOT EXISTS deposit_professional_percent integer;

ALTER TABLE public.staff
  ADD CONSTRAINT staff_commission_percent_range
  CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100));

ALTER TABLE public.staff
  ADD CONSTRAINT staff_deposit_recipient_valid
  CHECK (deposit_recipient IS NULL OR deposit_recipient IN ('studio', 'professional', 'split'));

ALTER TABLE public.staff
  ADD CONSTRAINT staff_deposit_professional_percent_range
  CHECK (deposit_professional_percent IS NULL OR (deposit_professional_percent >= 0 AND deposit_professional_percent <= 100));

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS commission_percent integer,
  ADD COLUMN IF NOT EXISTS deposit_recipient text,
  ADD COLUMN IF NOT EXISTS deposit_professional_percent integer;

ALTER TABLE public.services
  ADD CONSTRAINT services_commission_percent_range
  CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100));

ALTER TABLE public.services
  ADD CONSTRAINT services_deposit_recipient_valid
  CHECK (deposit_recipient IS NULL OR deposit_recipient IN ('studio', 'professional', 'split'));

ALTER TABLE public.services
  ADD CONSTRAINT services_deposit_professional_percent_range
  CHECK (deposit_professional_percent IS NULL OR (deposit_professional_percent >= 0 AND deposit_professional_percent <= 100));

COMMENT ON COLUMN public.studios.deposit_recipient IS 'Destino padrao do sinal online: studio, professional ou split.';
COMMENT ON COLUMN public.studios.deposit_professional_percent IS 'Percentual do sinal que entra para a profissional quando deposit_recipient = split.';
COMMENT ON COLUMN public.staff.commission_percent IS 'Override opcional de comissao para esta profissional.';
COMMENT ON COLUMN public.services.commission_percent IS 'Override opcional de comissao para este servico.';
