ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS booking_flow_mode text NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS booking_request_professional_mode text NOT NULL DEFAULT 'hidden';

ALTER TABLE public.studios
  DROP CONSTRAINT IF EXISTS studios_booking_flow_mode_check,
  DROP CONSTRAINT IF EXISTS studios_booking_request_professional_mode_check;

ALTER TABLE public.studios
  ADD CONSTRAINT studios_booking_flow_mode_check
    CHECK (booking_flow_mode IN ('online', 'request')),
  ADD CONSTRAINT studios_booking_request_professional_mode_check
    CHECK (booking_request_professional_mode IN ('hidden', 'showcase', 'preference'));

CREATE OR REPLACE VIEW public.public_studios
WITH (security_barrier = true)
AS
SELECT
  id, slug, name, tagline, description, hero_image_url, hero_gallery_urls,
  logo_url, brand_color, location, phone, email, whatsapp, instagram,
  timezone, currency, is_active, rating, reviews_count, updated_at,
  payment_policy, accepted_payment_methods, deposit_percent, public_amenities,
  min_booking_notice_min, business_segment, cancellation_min_notice_hours,
  cancellation_after_deadline_policy, refund_requests_enabled,
  cancellation_policy_text, legal_policy_version,
  stripe_connect_charges_enabled, stripe_connect_onboarding_completed,
  stripe_connect_mb_way_payments_enabled,
  booking_flow_mode, booking_request_professional_mode
FROM public.studios
WHERE is_active = true;

REVOKE ALL ON public.public_studios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_studios TO anon, authenticated;

-- Preserve the mature online-booking function as an internal core and put a
-- mode guard in front of it. Existing studios remain online by default.
DO $$
BEGIN
  IF to_regprocedure('public.create_public_booking_online_core(text,uuid,timestamptz,uuid[],text,text,text,text,text)') IS NULL THEN
    ALTER FUNCTION public.create_public_booking(
      text, uuid, timestamptz, uuid[], text, text, text, text, text
    ) RENAME TO create_public_booking_online_core;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.create_public_booking_online_core(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking_online_core(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_studio_slug text,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_service_ids uuid[],
  p_client_name text,
  p_client_phone text,
  p_client_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_customer_referral_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
BEGIN
  SELECT booking_flow_mode INTO v_mode
  FROM public.studios
  WHERE slug = p_studio_slug AND is_active = true;

  IF v_mode IS NULL THEN RAISE EXCEPTION 'studio_not_available'; END IF;
  IF v_mode <> 'online' THEN RAISE EXCEPTION 'booking_request_mode_only'; END IF;

  RETURN public.create_public_booking_online_core(
    p_studio_slug, p_staff_id, p_starts_at, p_service_ids,
    p_client_name, p_client_phone, p_client_email, p_notes,
    p_customer_referral_code
  );
END
$$;

REVOKE ALL ON FUNCTION public.create_public_booking(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
