-- Keep the existing settings and rewards. Full-access studio roles share management rights.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DROP POLICY IF EXISTS "Studio members manage loyalty settings" ON public.customer_loyalty_settings;
CREATE POLICY "Studio members manage loyalty settings"
ON public.customer_loyalty_settings FOR ALL TO authenticated
USING (
  public.is_studio_member(auth.uid(), studio_id)
  AND EXISTS (
    SELECT 1 FROM public.user_roles role
    WHERE role.user_id = auth.uid() AND role.studio_id = customer_loyalty_settings.studio_id
      AND role.role IN ('saas_owner', 'studio_owner', 'manager')
  )
)
WITH CHECK (
  public.is_studio_member(auth.uid(), studio_id)
  AND EXISTS (
    SELECT 1 FROM public.user_roles role
    WHERE role.user_id = auth.uid() AND role.studio_id = customer_loyalty_settings.studio_id
      AND role.role IN ('saas_owner', 'studio_owner', 'manager')
  )
);

-- A status update alone cannot award stamps without a recorded attendance decision.
CREATE OR REPLACE FUNCTION public.customer_loyalty_completed_appointment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed'
     AND NEW.attendance_resolved_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.process_customer_loyalty_for_completed_appointment(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
