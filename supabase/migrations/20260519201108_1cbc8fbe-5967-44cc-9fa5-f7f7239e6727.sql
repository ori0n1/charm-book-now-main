
ALTER TABLE public.upsell_offers
  ADD COLUMN IF NOT EXISTS views_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.track_upsell_views(p_offer_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_offer_ids IS NULL OR array_length(p_offer_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.upsell_offers
  SET views_count = views_count + 1
  WHERE id = ANY(p_offer_ids) AND is_active = true;
END
$$;

CREATE OR REPLACE FUNCTION public.track_upsell_acceptances(p_offer_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_offer_ids IS NULL OR array_length(p_offer_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.upsell_offers
  SET conversions_count = conversions_count + 1,
      extra_revenue = extra_revenue + discounted_price
  WHERE id = ANY(p_offer_ids) AND is_active = true;
END
$$;

GRANT EXECUTE ON FUNCTION public.track_upsell_views(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_upsell_acceptances(uuid[]) TO anon, authenticated;
