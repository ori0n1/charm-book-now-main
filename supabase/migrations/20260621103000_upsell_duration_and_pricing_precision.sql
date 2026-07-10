ALTER TABLE public.upsell_offers
  ADD COLUMN IF NOT EXISTS duration_min INTEGER CHECK (duration_min IS NULL OR duration_min > 0);

COMMENT ON COLUMN public.upsell_offers.duration_min IS
  'Optional duration override for this upsell offer. When null, the original service duration is used.';

CREATE OR REPLACE FUNCTION public.resolve_booking_service_pricing(
  p_studio_id uuid,
  p_service_ids uuid[]
)
RETURNS TABLE(
  service_id uuid,
  price numeric,
  duration_min integer,
  is_upsell boolean,
  offer_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH requested AS (
    SELECT u.service_id, u.ordinality::integer AS position
    FROM unnest(p_service_ids) WITH ORDINALITY AS u(service_id, ordinality)
  ),
  trigger_service AS (
    SELECT service_id AS id
    FROM requested
    WHERE position = 1
  )
  SELECT
    s.id AS service_id,
    CASE
      WHEN r.position > 1 AND uo.id IS NOT NULL THEN round(uo.discounted_price::numeric, 2)
      ELSE round(s.price::numeric, 2)
    END AS price,
    CASE
      WHEN r.position > 1 AND uo.id IS NOT NULL THEN COALESCE(uo.duration_min, s.duration_min)
      ELSE s.duration_min
    END AS duration_min,
    (r.position > 1) AS is_upsell,
    uo.id AS offer_id
  FROM requested r
  JOIN public.services s
    ON s.id = r.service_id
   AND s.studio_id = p_studio_id
   AND s.is_active = true
  CROSS JOIN trigger_service ts
  LEFT JOIN public.upsell_offers uo
    ON uo.studio_id = p_studio_id
   AND uo.trigger_service_id = ts.id
   AND uo.offered_service_id = s.id
   AND uo.is_active = true
  ORDER BY r.position;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_booking_service_pricing(uuid, uuid[]) TO anon, authenticated;
