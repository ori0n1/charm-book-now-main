-- Harden the public catalogue without exposing base-table columns, remove
-- repeated auth helper evaluation from RLS plans, and add the small set of
-- missing indexes proven relevant to the Dashboard and Clientes workloads.

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  GRANT EXECUTE ON FUNCTIONS TO service_role;

CREATE OR REPLACE FUNCTION private.catalog_public_studios()
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
  stripe_connect_charges_enabled boolean,
  stripe_connect_onboarding_completed boolean,
  stripe_connect_mb_way_payments_enabled boolean,
  booking_flow_mode text,
  booking_request_professional_mode text,
  notifications_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    studio.id, studio.slug, studio.name, studio.tagline, studio.description,
    studio.hero_image_url, studio.hero_gallery_urls, studio.logo_url,
    studio.brand_color, studio.location, studio.phone, studio.email,
    studio.whatsapp, studio.instagram, studio.timezone, studio.currency,
    studio.is_active,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'reviews') THEN studio.rating
      ELSE NULL::numeric(2,1)
    END::numeric(2,1),
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'reviews') THEN studio.reviews_count
      ELSE 0
    END,
    studio.updated_at,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.payment_policy
      ELSE 'pay_in_studio'
    END,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.accepted_payment_methods
      ELSE ARRAY[]::text[]
    END,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.deposit_percent
      ELSE 0
    END,
    studio.public_amenities, studio.min_booking_notice_min, studio.business_segment,
    studio.cancellation_min_notice_hours, studio.cancellation_after_deadline_policy,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.refund_requests_enabled
      ELSE false
    END,
    studio.cancellation_policy_text, studio.legal_policy_version,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.stripe_connect_charges_enabled
      ELSE false
    END,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.stripe_connect_onboarding_completed
      ELSE false
    END,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.stripe_connect_mb_way_payments_enabled
      ELSE false
    END,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'whatsapp') THEN studio.booking_flow_mode
      ELSE 'online'
    END,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'whatsapp') THEN studio.booking_request_professional_mode
      ELSE 'hidden'
    END,
    public.studio_has_entitlement(studio.id, 'notifications')
  FROM public.studios AS studio
  WHERE studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'public_page');
$function$;

CREATE OR REPLACE FUNCTION private.catalog_public_service_categories()
RETURNS TABLE (id uuid, studio_id uuid, label text, sort_order integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT category.id, category.studio_id, category.label, category.sort_order
  FROM public.service_categories AS category
  JOIN public.studios AS studio ON studio.id = category.studio_id
  WHERE studio.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION private.catalog_public_services()
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
SET search_path = ''
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

CREATE OR REPLACE FUNCTION private.catalog_public_staff()
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
  current_status text,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    member.id, member.studio_id, member.name, member.role, member.bio,
    member.photo_url, member.rating, member.reviews_count, member.is_active,
    member.current_status, member.sort_order
  FROM public.staff AS member
  JOIN public.studios AS studio ON studio.id = member.studio_id
  WHERE studio.is_active = true
    AND member.is_active = true
    AND public.studio_staff_is_within_plan(member.studio_id, member.id);
$function$;

CREATE OR REPLACE FUNCTION private.catalog_public_staff_services()
RETURNS TABLE (studio_id uuid, staff_id uuid, service_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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

CREATE OR REPLACE FUNCTION private.catalog_public_upsell_offers()
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
SET search_path = ''
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

REVOKE EXECUTE ON FUNCTION private.catalog_public_studios() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.catalog_public_service_categories() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.catalog_public_services() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.catalog_public_staff() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.catalog_public_staff_services() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.catalog_public_upsell_offers() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.catalog_public_studios() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_public_service_categories() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_public_services() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_public_staff() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_public_staff_services() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.catalog_public_upsell_offers() TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.public_studios
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
  catalog.legal_policy_version, catalog.stripe_connect_charges_enabled,
  catalog.stripe_connect_onboarding_completed,
  catalog.stripe_connect_mb_way_payments_enabled, catalog.booking_flow_mode,
  catalog.booking_request_professional_mode, catalog.notifications_enabled
FROM private.catalog_public_studios() AS catalog;

CREATE OR REPLACE VIEW public.public_service_categories
WITH (security_barrier = true, security_invoker = true)
AS
SELECT category.id, category.studio_id, category.label, category.sort_order
FROM private.catalog_public_service_categories() AS category;

CREATE OR REPLACE VIEW public.public_services
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
  service.id, service.studio_id, service.category_id, service.name,
  service.description, service.duration_min,
  service.price::numeric(10,2) AS price, service.is_recommended,
  service.is_active, service.media, service.sort_order
FROM private.catalog_public_services() AS service;

CREATE OR REPLACE VIEW public.public_staff
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
  member.id, member.studio_id, member.name, member.role, member.bio,
  member.photo_url, member.rating::numeric(2,1) AS rating,
  member.reviews_count, member.is_active, member.current_status, member.sort_order
FROM private.catalog_public_staff() AS member;

CREATE OR REPLACE VIEW public.public_staff_services
WITH (security_barrier = true, security_invoker = true)
AS
SELECT link.studio_id, link.staff_id, link.service_id
FROM private.catalog_public_staff_services() AS link;

CREATE OR REPLACE VIEW public.public_upsell_offers
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
  offer.id, offer.studio_id, offer.trigger_service_id, offer.offered_service_id,
  offer.discounted_price::numeric(10,2) AS discounted_price,
  offer.description, offer.is_active, offer.discount_type,
  offer.discount_value::numeric(10,2) AS discount_value,
  offer.display_mode, offer.duration_min
FROM private.catalog_public_upsell_offers() AS offer;

REVOKE ALL ON TABLE
  public.public_studios,
  public.public_service_categories,
  public.public_services,
  public.public_staff,
  public.public_staff_services,
  public.public_upsell_offers
FROM PUBLIC;

GRANT SELECT ON TABLE
  public.public_studios,
  public.public_service_categories,
  public.public_services,
  public.public_staff,
  public.public_staff_services,
  public.public_upsell_offers
TO anon, authenticated, service_role;

DO $auth_initplan$
DECLARE
  target record;
  statement text;
  new_using text;
  new_check text;
  target_count integer;
BEGIN
  SELECT count(*)
  INTO target_count
  FROM pg_policy AS policy
  JOIN pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND (
      (
        coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') ~ 'auth\.(uid|role)\(\)'
        AND coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') !~* 'select auth\.(uid|role)\(\)'
      )
      OR (
        coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '') ~ 'auth\.(uid|role)\(\)'
        AND coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '') !~* 'select auth\.(uid|role)\(\)'
      )
    );

  IF target_count NOT IN (0, 59) THEN
    RAISE EXCEPTION 'unexpected_auth_rls_initplan_policy_count: %', target_count;
  END IF;

  FOR target IN
    SELECT
      policy.polname,
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
      pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression
    FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND (
        (
          coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') ~ 'auth\.(uid|role)\(\)'
          AND coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') !~* 'select auth\.(uid|role)\(\)'
        )
        OR (
          coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '') ~ 'auth\.(uid|role)\(\)'
          AND coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '') !~* 'select auth\.(uid|role)\(\)'
        )
      )
  LOOP
    new_using := target.using_expression;
    new_check := target.check_expression;
    IF new_using IS NOT NULL THEN
      new_using := replace(new_using, 'auth.uid()', '(select auth.uid())');
      new_using := replace(new_using, 'auth.role()', '(select auth.role())');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := replace(new_check, 'auth.uid()', '(select auth.uid())');
      new_check := replace(new_check, 'auth.role()', '(select auth.role())');
    END IF;

    statement := format(
      'ALTER POLICY %I ON %I.%I',
      target.polname,
      target.schema_name,
      target.table_name
    );
    IF new_using IS NOT NULL THEN
      statement := statement || format(' USING (%s)', new_using);
    END IF;
    IF new_check IS NOT NULL THEN
      statement := statement || format(' WITH CHECK (%s)', new_check);
    END IF;
    EXECUTE statement;
  END LOOP;
END
$auth_initplan$;

ALTER FUNCTION public.get_or_create_referral_code(uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_studio_id_by_referral_code(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.normalize_customer_referral_code(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.refresh_studio_rating()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.request_header(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog, public;

CREATE SCHEMA IF NOT EXISTS extensions;
DO $extension_schema$
DECLARE
  current_schema text;
BEGIN
  SELECT namespace.nspname
  INTO current_schema
  FROM pg_extension AS extension_row
  JOIN pg_namespace AS namespace ON namespace.oid = extension_row.extnamespace
  WHERE extension_row.extname = 'btree_gist';

  IF current_schema IS NULL THEN
    RAISE EXCEPTION 'required_extension_missing: btree_gist';
  END IF;
  IF current_schema <> 'extensions' THEN
    ALTER EXTENSION btree_gist SET SCHEMA extensions;
  END IF;
END
$extension_schema$;

CREATE INDEX IF NOT EXISTS idx_appointments_client_studio
  ON public.appointments (client_id, studio_id);
CREATE INDEX IF NOT EXISTS idx_appointments_staff_studio
  ON public.appointments (staff_id, studio_id);
CREATE INDEX IF NOT EXISTS idx_appointment_services_service
  ON public.appointment_services (service_id);
CREATE INDEX IF NOT EXISTS idx_services_category
  ON public.services (category_id);
CREATE INDEX IF NOT EXISTS idx_staff_user
  ON public.staff (user_id);
CREATE INDEX IF NOT EXISTS idx_staff_services_service
  ON public.staff_services (service_id);

NOTIFY pgrst, 'reload schema';
