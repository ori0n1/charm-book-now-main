-- Ensure every appointment has a public token for /r/{orderId} and /marcacao/{token}.
-- Recent booking functions can insert appointments without explicitly setting
-- public_token; the trigger keeps this invariant in one database-level place.

CREATE OR REPLACE FUNCTION public.ensure_appointment_public_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.public_token IS NULL OR length(trim(NEW.public_token)) < 16 THEN
    NEW.public_token := replace(gen_random_uuid()::text, '-', '') || left(replace(gen_random_uuid()::text, '-', ''), 8);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ensure_appointment_public_token ON public.appointments;
CREATE TRIGGER trg_ensure_appointment_public_token
BEFORE INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.ensure_appointment_public_token();

UPDATE public.appointments
SET public_token = replace(gen_random_uuid()::text, '-', '') || left(replace(gen_random_uuid()::text, '-', ''), 8),
    updated_at = now()
WHERE public_token IS NULL OR length(trim(public_token)) < 16;

