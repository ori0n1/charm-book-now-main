CREATE OR REPLACE FUNCTION public.record_upsell_acceptances_for_services(
  p_studio_id uuid,
  p_service_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  WITH accepted AS (
    SELECT offer_id, price
    FROM public.resolve_booking_service_pricing(p_studio_id, p_service_ids)
    WHERE offer_id IS NOT NULL
  )
  UPDATE public.upsell_offers u
  SET conversions_count = u.conversions_count + 1,
      views_count = GREATEST(u.views_count, u.conversions_count + 1),
      extra_revenue = u.extra_revenue + accepted.price
  FROM accepted
  WHERE u.id = accepted.offer_id
    AND u.is_active = true;
END;
$$;

WITH fixed AS (
  SELECT id, conversions_count
  FROM public.upsell_offers
  WHERE conversions_count > views_count
)
UPDATE public.upsell_offers u
SET views_count = fixed.conversions_count
FROM fixed
WHERE u.id = fixed.id;