-- Restore the production policy captured before the loyalty release.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DROP POLICY IF EXISTS "Studio members manage loyalty settings" ON public.customer_loyalty_settings;
CREATE POLICY "Studio members manage loyalty settings"
ON public.customer_loyalty_settings FOR ALL TO authenticated
USING (public.is_studio_member(auth.uid(), studio_id))
WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE OR REPLACE FUNCTION public.customer_loyalty_completed_appointment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.process_customer_loyalty_for_completed_appointment(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
