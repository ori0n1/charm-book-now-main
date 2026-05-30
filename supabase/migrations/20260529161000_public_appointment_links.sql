ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_appointments_public_token
  ON public.appointments(public_token);

UPDATE public.appointments
SET public_token = replace(gen_random_uuid()::text, '-', '') || left(replace(gen_random_uuid()::text, '-', ''), 8)
WHERE public_token IS NULL;
