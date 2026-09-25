-- Keep the public catalogue allowlist while removing SECURITY DEFINER views
-- from the exposed `public` schema. The invoker views call narrowly scoped
-- SECURITY DEFINER functions in `private`, a schema PostgREST does not expose.

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  GRANT EXECUTE ON FUNCTIONS TO service_role;

CREATE OR REPLACE FUNCTION private.catalog_booking_studios()
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  tagline text,
  description text,
  hero_image_url text,
  hero_gallery_urls jsonb,
  logo_url text,
  brand_color text,
  location text,
  phone text,
  email text,
  whatsapp text,
  instagram text,
  timezone text,
  currency text,
  is_active boolean,
  rating numeric(2,1),
  reviews_count integer,
  updated_at timestamptz,
  payment_policy text,
  accepted_payment_methods text[],
  deposit_percent integer,
  public_amenities jsonb,
  min_booking_notice_min integer,
  business_segment text,
  cancellation_min_notice_hours integer,
  cancellation_after_deadline_policy text,
  refund_requests_enabled boolean,
  cancellation_policy_text text,
  legal_policy_version text,
  booking_flow_mode text,
  booking_request_professional_mode text,
  online_payment_ready boolean,
  mb_way_payment_ready boolean,
  public_notifications_available boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    catalog.id, catalog.slug, catalog.name, catalog.tagline, catalog.description,
    catalog.hero_image_url, catalog.hero_gallery_urls, catalog.logo_url,
    catalog.brand_color, catalog.location, catalog.phone, catalog.email,
    catalog.whatsapp, catalog.instagram, catalog.timezone, catalog.currency,
    catalog.is_active, catalog.rating, catalog.reviews_count, catalog.updated_at,
    catalog.payment_policy, catalog.accepted_payment_methods, catalog.deposit_percent,
    catalog.public_amenities, catalog.min_booking_notice_min, catalog.business_segment,
    catalog.cancellation_min_notice_hours, catalog.cancellation_after_deadline_policy,
    catalog.refund_requests_enabled, catalog.cancellation_policy_text,
    catalog.legal_policy_version, catalog.booking_flow_mode,
    catalog.booking_request_professional_mode,
    (coalesce(catalog.stripe_connect_charges_enabled, false)
      AND coalesce(catalog.stripe_connect_onboarding_completed, false)),
    (coalesce(catalog.stripe_connect_charges_enabled, false)
      AND coalesce(catalog.stripe_connect_onboarding_completed, false)
      AND coalesce(catalog.stripe_connect_mb_way_payments_enabled, false)),
    coalesce(catalog.notifications_enabled, false)
  FROM public.public_studios AS catalog;
$function$;

CREATE OR REPLACE FUNCTION private.catalog_booking_staff()
RETURNS TABLE (
  id uuid,
  studio_id uuid,
  name text,
  role text,
  bio text,
  photo_url text,
  rating numeric(2,1),
  reviews_count integer,
  is_active boolean,
  sort_order integer,
  booking_availability_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    member.id, member.studio_id, member.name, member.role, member.bio,
    member.photo_url, member.rating, member.reviews_count, member.is_active,
    member.sort_order,
    CASE
      WHEN member.current_status IN ('busy', 'absent') THEN member.current_status
      ELSE 'online'
    END
  FROM public.public_staff AS member;
$function$;

CREATE OR REPLACE FUNCTION private.catalog_service_categories()
RETURNS TABLE (
  id uuid,
  studio_id uuid,
  label text,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT category.id, category.studio_id, category.label, category.sort_order
  FROM public.service_categories AS category
  JOIN public.studios AS studio ON studio.id = category.studio_id
  WHERE studio.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION private.catalog_services()
RETURNS TABLE (
  id uuid,
  studio_id uuid,
  category_id uuid,
  name text,
  description text,
  duration_min integer,
  price numeric(10,2),
  is_recommended boolean,
  is_active boolean,
  media jsonb,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    service.id, service.studio_id, service.category_id, service.name,
    service.description, service.duration_min, service.price,
    service.is_recommended, service.is_active, service.media, service.sort_order
  FROM public.services AS service
  JOIN public.studios AS studio ON studio.id = service.studio_id
  WHERE studio.is_active = true
    AND service.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION private.catalog_staff_services()
RETURNS TABLE (
  studio_id uuid,
  staff_id uuid,
  service_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT member.studio_id, link.staff_id, link.service_id
  FROM public.staff_services AS link
  JOIN public.staff AS member
    ON member.id = link.staff_id
   AND member.is_active = true
  JOIN public.services AS service
    ON service.id = link.service_id
   AND service.studio_id = member.studio_id
   AND service.is_active = true
  JOIN public.studios AS studio
    ON studio.id = member.studio_id
   AND studio.is_active = true
  WHERE public.studio_staff_is_within_plan(member.studio_id, member.id);
$function$;

CREATE OR REPLACE FUNCTION private.catalog_upsell_offers()
RETURNS TABLE (
  id uuid,
  studio_id uuid,
  trigger_service_id uuid,
  offered_service_id uuid,
  discounted_price numeric(10,2),
  description text,
  is_active boolean,
  discount_type text,
  discount_value numeric(10,2),
  display_mode text,
  duration_min integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    offer.id, offer.studio_id, offer.trigger_service_id, offer.offered_service_id,
    offer.discounted_price, offer.description, offer.is_active,
    offer.discount_type, offer.discount_value, offer.display_mode, offer.duration_min
  FROM public.upsell_offers AS offer
  JOIN public.studios AS studio ON studio.id = offer.studio_id
  WHERE studio.is_active = true
    AND offer.is_active = true
    AND public.studio_has_entitlement(offer.studio_id, 'promotions');
$function$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.catalog_booking_studios() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_booking_staff() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_service_categories() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_services() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_staff_services() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_upsell_offers() TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.public_booking_studios
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
  catalog.id, catalog.slug, catalog.name, catalog.tagline, catalog.description,
  catalog.hero_image_url, catalog.hero_gallery_urls, catalog.logo_url,
  catalog.brand_color, catalog.location, catalog.phone, catalog.email,
  catalog.whatsapp, catalog.instagram, catalog.timezone, catalog.currency,
  catalog.is_active, catalog.rating::numeric(2,1) AS rating,
  catalog.reviews_count, catalog.updated_at, catalog.payment_policy,
  catalog.accepted_payment_methods, catalog.deposit_percent,
  catalog.public_amenities, catalog.min_booking_notice_min, catalog.business_segment,
  catalog.cancellation_min_notice_hours, catalog.cancellation_after_deadline_policy,
  catalog.refund_requests_enabled, catalog.cancellation_policy_text,
  catalog.legal_policy_version, catalog.booking_flow_mode,
  catalog.booking_request_professional_mode, catalog.online_payment_ready,
  catalog.mb_way_payment_ready, catalog.public_notifications_available
FROM private.catalog_booking_studios() AS catalog;

CREATE OR REPLACE VIEW public.public_booking_staff
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
  member.id, member.studio_id, member.name, member.role, member.bio,
  member.photo_url, member.rating::numeric(2,1) AS rating,
  member.reviews_count, member.is_active, member.sort_order,
  member.booking_availability_status
FROM private.catalog_booking_staff() AS member;

CREATE OR REPLACE VIEW public.public_service_categories
WITH (security_barrier = true, security_invoker = true)
AS
SELECT category.id, category.studio_id, category.label, category.sort_order
FROM private.catalog_service_categories() AS category;

CREATE OR REPLACE VIEW public.public_services
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
  service.id, service.studio_id, service.category_id, service.name,
  service.description, service.duration_min,
  service.price::numeric(10,2) AS price, service.is_recommended,
  service.is_active, service.media, service.sort_order
FROM private.catalog_services() AS service;

CREATE OR REPLACE VIEW public.public_staff_services
WITH (security_barrier = true, security_invoker = true)
AS
SELECT link.studio_id, link.staff_id, link.service_id
FROM private.catalog_staff_services() AS link;

CREATE OR REPLACE VIEW public.public_upsell_offers
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
  offer.id, offer.studio_id, offer.trigger_service_id, offer.offered_service_id,
  offer.discounted_price::numeric(10,2) AS discounted_price,
  offer.description, offer.is_active, offer.discount_type,
  offer.discount_value::numeric(10,2) AS discount_value,
  offer.display_mode, offer.duration_min
FROM private.catalog_upsell_offers() AS offer;

-- The public functions are no longer needed by anonymous view execution. The
-- availability RPC remains the sole intentional anonymous SECURITY DEFINER RPC.
REVOKE EXECUTE ON FUNCTION public.studio_has_entitlement(uuid, text, timestamptz)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.studio_staff_is_within_plan(uuid, uuid)
  FROM anon;

NOTIFY pgrst, 'reload schema';
