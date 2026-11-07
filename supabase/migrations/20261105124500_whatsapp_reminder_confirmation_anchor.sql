-- Record the effective confirmation instant for WhatsApp reminder scheduling.
-- Existing confirmed appointments remain NULL and keep the legacy reminder path.
-- Their confirmation instant is not inferred from creation or message timestamps.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS whatsapp_reminder_confirmed_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_whatsapp_reminder_confirmed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' THEN
      NEW.whatsapp_reminder_confirmed_at := now();
    END IF;
  ELSIF NEW.status = 'confirmed' AND (
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.starts_at IS DISTINCT FROM NEW.starts_at
  ) THEN
    NEW.whatsapp_reminder_confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_whatsapp_reminder_confirmed_at ON public.appointments;
CREATE TRIGGER trg_whatsapp_reminder_confirmed_at
BEFORE INSERT OR UPDATE OF status, starts_at ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_reminder_confirmed_at();
