-- Prospective protection only. The two already-expired bookings with a missing
-- service are deliberately unchanged pending a separate historical decision.

-- Lock the service rows referenced by a new/changed booking array, so a
-- concurrent service deletion cannot race the tenant check.
CREATE OR REPLACE FUNCTION public.assert_booking_service_ids_same_studio()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_service_id uuid;
BEGIN
  FOREACH v_service_id IN ARRAY NEW.service_ids LOOP
    PERFORM 1 FROM public.services s
    WHERE s.id = v_service_id AND s.studio_id = NEW.studio_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking_service_ids_tenant_mismatch' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.assert_booking_service_ids_same_studio() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reject_delete_referenced_booking_service()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.booking_payment_requests b
    WHERE OLD.id = ANY(b.service_ids)
  ) THEN
    RAISE EXCEPTION 'service_referenced_by_booking_history' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END
$function$;
REVOKE ALL ON FUNCTION public.reject_delete_referenced_booking_service() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_preserve_booking_service_history
  BEFORE DELETE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.reject_delete_referenced_booking_service();

CREATE OR REPLACE FUNCTION public.remove_or_archive_service(
  p_studio_id uuid,
  p_service_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_has_history boolean;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), p_studio_id, 'studio_owner') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.services
  WHERE id = p_service_id AND studio_id = p_studio_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT
    EXISTS (SELECT 1 FROM public.appointment_services WHERE service_id = p_service_id)
    OR EXISTS (SELECT 1 FROM public.manual_service_entries WHERE service_id = p_service_id)
    OR EXISTS (SELECT 1 FROM public.booking_payment_requests WHERE p_service_id = ANY(service_ids))
  INTO v_has_history;

  IF v_has_history THEN
    UPDATE public.services
    SET is_active = false, is_recommended = false
    WHERE id = p_service_id AND studio_id = p_studio_id;
    UPDATE public.upsell_offers SET is_active = false
    WHERE studio_id = p_studio_id
      AND (trigger_service_id = p_service_id OR offered_service_id = p_service_id);
    RETURN 'archived';
  END IF;

  BEGIN
    DELETE FROM public.services WHERE id = p_service_id AND studio_id = p_studio_id;
    RETURN 'deleted';
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE public.services
    SET is_active = false, is_recommended = false
    WHERE id = p_service_id AND studio_id = p_studio_id;
    UPDATE public.upsell_offers SET is_active = false
    WHERE studio_id = p_studio_id
      AND (trigger_service_id = p_service_id OR offered_service_id = p_service_id);
    RETURN 'archived';
  END;
END
$function$;

REVOKE ALL ON FUNCTION public.remove_or_archive_service(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_or_archive_service(uuid, uuid) TO authenticated;
