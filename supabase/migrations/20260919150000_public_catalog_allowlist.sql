-- Public booking data is an explicit allowlist. The older views remain for
-- trusted code, but anon/authenticated must use the narrower projections.
-- Roll this out together with application code that reads the new views.

CREATE OR REPLACE VIEW public.public_booking_studios
WITH (security_barrier = true)
AS
SELECT
  id, slug, name, tagline, description,
  hero_image_url, hero_gallery_urls, logo_url, brand_color,
  location, phone, email, whatsapp, instagram, timezone, currency,
  is_active, rating, reviews_count, updated_at,
  payment_policy, accepted_payment_methods, deposit_percent,
  public_amenities, min_booking_notice_min, business_segment,
  cancellation_min_notice_hours, cancellation_after_deadline_policy,
  refund_requests_enabled, cancellation_policy_text, legal_policy_version,
  booking_flow_mode, booking_request_professional_mode,
  (coalesce(stripe_connect_charges_enabled, false)
    AND coalesce(stripe_connect_onboarding_completed, false)) AS online_payment_ready,
  (coalesce(stripe_connect_charges_enabled, false)
    AND coalesce(stripe_connect_onboarding_completed, false)
    AND coalesce(stripe_connect_mb_way_payments_enabled, false)) AS mb_way_payment_ready,
  coalesce(notifications_enabled, false) AS public_notifications_available
FROM public.public_studios;

CREATE OR REPLACE VIEW public.public_booking_staff
WITH (security_barrier = true)
AS
SELECT
  id, studio_id, name, role, bio, photo_url, rating, reviews_count,
  is_active, sort_order,
  CASE
    WHEN current_status IN ('busy', 'absent') THEN current_status
    ELSE 'online'
  END AS booking_availability_status
FROM public.public_staff;

REVOKE ALL ON public.public_booking_studios FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_booking_staff FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_booking_studios TO anon, authenticated;
GRANT SELECT ON public.public_booking_staff TO anon, authenticated;

REVOKE SELECT ON public.public_studios FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.public_staff FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
