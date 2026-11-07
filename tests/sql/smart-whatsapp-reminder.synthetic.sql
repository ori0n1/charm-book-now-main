\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() NOT LIKE 'codex_bellza_reminder_%' THEN
    RAISE EXCEPTION 'synthetic database required';
  END IF;
END;
$guard$;

CREATE TABLE public.appointments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status text NOT NULL,
  starts_at timestamptz NOT NULL,
  note text
);

INSERT INTO public.appointments(status, starts_at) VALUES
  ('confirmed', now() + interval '2 days'),
  ('pending_payment', now() + interval '2 days');

\ir ../../supabase/migrations/20261105124500_whatsapp_reminder_confirmation_anchor.sql

DO $assert$
BEGIN
  IF (SELECT whatsapp_reminder_confirmed_at FROM public.appointments WHERE id = 1) IS NOT NULL
     OR (SELECT whatsapp_reminder_confirmed_at FROM public.appointments WHERE id = 2) IS NOT NULL THEN
    RAISE EXCEPTION 'migration inferred a historical confirmation';
  END IF;
END;
$assert$;

INSERT INTO public.appointments(status, starts_at) VALUES
  ('confirmed', now() + interval '2 days'),
  ('pending_payment', now() + interval '2 days');

DO $assert$
BEGIN
  IF (SELECT whatsapp_reminder_confirmed_at FROM public.appointments WHERE id = 3) IS NULL THEN
    RAISE EXCEPTION 'confirmed insert lacked anchor';
  END IF;
  IF (SELECT whatsapp_reminder_confirmed_at FROM public.appointments WHERE id = 4) IS NOT NULL THEN
    RAISE EXCEPTION 'pending appointment received anchor';
  END IF;
END;
$assert$;

UPDATE public.appointments SET status = 'confirmed' WHERE id = 4;
UPDATE public.appointments SET whatsapp_reminder_confirmed_at = '2000-01-01' WHERE id = 3;
UPDATE public.appointments SET starts_at = starts_at + interval '1 hour' WHERE id = 3;

DO $assert$
BEGIN
  IF (SELECT whatsapp_reminder_confirmed_at FROM public.appointments WHERE id = 4) IS NULL THEN
    RAISE EXCEPTION 'effective payment confirmation lacked anchor';
  END IF;
  IF (SELECT whatsapp_reminder_confirmed_at FROM public.appointments WHERE id = 3) <= '2000-01-01' THEN
    RAISE EXCEPTION 'reschedule did not reset anchor';
  END IF;
END;
$assert$;

CREATE TEMP TABLE anchor_before AS
SELECT whatsapp_reminder_confirmed_at AS anchor FROM public.appointments WHERE id = 3;
UPDATE public.appointments SET note = 'unchanged schedule' WHERE id = 3;

DO $assert$
BEGIN
  IF (SELECT whatsapp_reminder_confirmed_at FROM public.appointments WHERE id = 3)
     IS DISTINCT FROM (SELECT anchor FROM anchor_before) THEN
    RAISE EXCEPTION 'unrelated update changed reminder anchor';
  END IF;
END;
$assert$;
