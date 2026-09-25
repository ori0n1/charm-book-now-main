-- Reject new or changed booking service arrays containing a deleted service
-- or a service from another tenant. Existing rows are not rewritten: the
-- live inventory on 2026-09-19 found two legacy missing-service references.
CREATE OR REPLACE FUNCTION public.assert_booking_service_ids_same_studio()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.service_ids) AS requested(service_id)
    LEFT JOIN public.services s ON s.id = requested.service_id
    WHERE s.id IS NULL OR s.studio_id IS DISTINCT FROM NEW.studio_id
  ) THEN
    RAISE EXCEPTION 'booking_service_ids_tenant_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_booking_service_ids_same_studio() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_booking_service_ids_same_studio
  BEFORE INSERT OR UPDATE OF service_ids, studio_id
  ON public.booking_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.assert_booking_service_ids_same_studio();
