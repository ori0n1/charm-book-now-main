-- Read-only assertions for 20260922130000_private_catalog_invoker_views.
DO $test$
DECLARE
  view_name text;
  relation_options text[];
  function_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'public_booking_studios',
    'public_booking_staff',
    'public_service_categories',
    'public_services',
    'public_staff_services',
    'public_upsell_offers'
  ] LOOP
    SELECT relation.reloptions
    INTO relation_options
    FROM pg_class AS relation
    JOIN pg_namespace AS relation_schema
      ON relation_schema.oid = relation.relnamespace
    WHERE relation_schema.nspname = 'public'
      AND relation.relname = view_name
      AND relation.relkind = 'v';

    IF relation_options IS NULL
      OR NOT relation_options @> ARRAY['security_invoker=true'] THEN
      RAISE EXCEPTION 'catalog_view_not_security_invoker: %', view_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY ARRAY[
    'catalog_booking_studios',
    'catalog_booking_staff',
    'catalog_service_categories',
    'catalog_services',
    'catalog_staff_services',
    'catalog_upsell_offers'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS function_row
      JOIN pg_namespace AS function_schema
        ON function_schema.oid = function_row.pronamespace
      WHERE function_schema.nspname = 'private'
        AND function_row.proname = function_name
        AND function_row.prosecdef
        AND coalesce(function_row.proconfig, ARRAY[]::text[])
          && ARRAY['search_path=pg_catalog, public', 'search_path=pg_catalog,public']
    ) THEN
      RAISE EXCEPTION 'private_catalog_function_invalid: %', function_name;
    END IF;
  END LOOP;

  IF has_function_privilege(
    'anon',
    'public.studio_has_entitlement(uuid,text,timestamp with time zone)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.studio_staff_is_within_plan(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'legacy_public_catalog_helper_still_exposed';
  END IF;
END
$test$;

SELECT
  count(*) FILTER (WHERE has_function_privilege('anon', function_row.oid, 'EXECUTE'))
    AS anon_public_security_definer_executable,
  count(*) FILTER (WHERE has_function_privilege('authenticated', function_row.oid, 'EXECUTE'))
    AS authenticated_public_security_definer_executable
FROM pg_proc AS function_row
JOIN pg_namespace AS function_schema
  ON function_schema.oid = function_row.pronamespace
WHERE function_schema.nspname = 'public'
  AND function_row.prosecdef;
