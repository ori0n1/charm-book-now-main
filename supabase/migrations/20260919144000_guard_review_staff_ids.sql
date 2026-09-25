-- The other UUID array outside ordinary FKs is studio_reviews.staff_ids.
-- Production inventory on 2026-09-19: 14 valid references, zero mismatches.
CREATE OR REPLACE FUNCTION public.assert_review_staff_ids_same_studio()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.staff_ids) AS requested(staff_id)
    LEFT JOIN public.staff st ON st.id = requested.staff_id
    WHERE st.id IS NULL OR st.studio_id IS DISTINCT FROM NEW.studio_id
  ) THEN
    RAISE EXCEPTION 'review_staff_ids_tenant_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_review_staff_ids_same_studio() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_review_staff_ids_same_studio
  BEFORE INSERT OR UPDATE OF staff_ids, studio_id ON public.studio_reviews
  FOR EACH ROW EXECUTE FUNCTION public.assert_review_staff_ids_same_studio();
CREATE TRIGGER trg_studio_reviews_studio_immutable
  BEFORE UPDATE OF studio_id ON public.studio_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
