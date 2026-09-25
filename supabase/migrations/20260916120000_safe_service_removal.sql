-- Remove services without losing appointment or financial history.
-- Historical services remain available to reports, but are hidden from every
-- new-booking flow through the existing services.is_active filters.
CREATE OR REPLACE FUNCTION public.remove_or_archive_service(
  p_studio_id uuid,
  p_service_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_history boolean;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), p_studio_id, 'studio_owner') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- The tenant predicate is part of the lookup so a caller cannot use this
  -- function to discover or mutate a service belonging to another studio.
  PERFORM 1
  FROM public.services
  WHERE id = p_service_id
    AND studio_id = p_studio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.appointment_services
      WHERE service_id = p_service_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.manual_service_entries
      WHERE service_id = p_service_id
    )
  INTO v_has_history;

  IF v_has_history THEN
    UPDATE public.services
    SET is_active = false,
        is_recommended = false
    WHERE id = p_service_id
      AND studio_id = p_studio_id;

    UPDATE public.upsell_offers
    SET is_active = false
    WHERE studio_id = p_studio_id
      AND (trigger_service_id = p_service_id OR offered_service_id = p_service_id);

    RETURN 'archived';
  END IF;

  -- If another historical relation is introduced now or a concurrent insert
  -- wins the race, the FK remains the final safety net and we archive instead.
  BEGIN
    DELETE FROM public.services
    WHERE id = p_service_id
      AND studio_id = p_studio_id;

    RETURN 'deleted';
  EXCEPTION
    WHEN foreign_key_violation THEN
      UPDATE public.services
      SET is_active = false,
          is_recommended = false
      WHERE id = p_service_id
        AND studio_id = p_studio_id;

      UPDATE public.upsell_offers
      SET is_active = false
      WHERE studio_id = p_studio_id
        AND (trigger_service_id = p_service_id OR offered_service_id = p_service_id);

      RETURN 'archived';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_or_archive_service(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_or_archive_service(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.remove_or_archive_service(uuid, uuid) IS
  'Deletes an unused service or archives it when historical references must be preserved.';

-- Force every authenticated deletion through the protected routine. Existing
-- members retain the same read/create/update access they had before.
DROP POLICY IF EXISTS "Members manage services" ON public.services;
DROP POLICY IF EXISTS "Members read services" ON public.services;
DROP POLICY IF EXISTS "Members create services" ON public.services;
DROP POLICY IF EXISTS "Members update services" ON public.services;

CREATE POLICY "Members read services"
  ON public.services FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

CREATE POLICY "Members create services"
  ON public.services FOR INSERT TO authenticated
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

CREATE POLICY "Members update services"
  ON public.services FOR UPDATE TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

NOTIFY pgrst, 'reload schema';
