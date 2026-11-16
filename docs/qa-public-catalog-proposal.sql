-- PROPOSAL ONLY. Requires separate authorization for a production migration.
-- Baseline hashes are pg_get_functiondef MD5 values read from production on 2026-11-16.
-- The six functions are STABLE SECURITY DEFINER and back six anon-readable
-- public catalog views. No signature, owner, grant, RLS or real studio changes.
BEGIN;
DO $qa_visibility$
DECLARE
  baseline jsonb := '{
    "catalog_public_service_categories":"bd511f425d0c8a33d31c34b34313c86d",
    "catalog_public_services":"eef0f0e62a01b5b8c2b6c340cc6a8437",
    "catalog_public_staff":"77bc76cff466331aa68bc4f2e0da7a3c",
    "catalog_public_staff_services":"f988bf8481988960be22edd3deea3ab0",
    "catalog_public_studios":"2fc64617d4de8d2aa914b7d58d03d526",
    "catalog_public_upsell_offers":"8492dd3f086764f48ee4d0000d6dd04f"
  }'::jsonb;
  function_name text;
  function_oid oid;
  is_definer boolean;
  volatility "char";
  definition text;
  original_filter text := 'studio.is_active = true';
  protected_filter text := 'studio.is_active = true AND studio.id NOT IN (''e2663064-7774-41c5-95cb-e5e6afc4fab4''::uuid, ''2cc1683e-ab91-4488-a702-6a8feb60f379''::uuid)';
BEGIN
  FOR function_name IN SELECT jsonb_object_keys(baseline) LOOP
    SELECT p.oid, p.prosecdef, p.provolatile
      INTO function_oid, is_definer, volatility
      FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = function_name AND p.pronargs = 0;
    IF function_oid IS NULL OR is_definer IS DISTINCT FROM true OR volatility IS DISTINCT FROM 's' THEN
      RAISE EXCEPTION 'QA visibility: function % missing or attributes changed', function_name;
    END IF;
    definition := pg_get_functiondef(function_oid);
    IF md5(definition) = (baseline ->> function_name) THEN
      IF length(definition) - length(replace(definition, original_filter, '')) <> length(original_filter) THEN
        RAISE EXCEPTION 'QA visibility: expected one studio filter in %', function_name;
      END IF;
      EXECUTE replace(definition, original_filter, protected_filter);
    ELSIF position(protected_filter IN definition) > 0
       AND md5(replace(definition, protected_filter, original_filter)) = (baseline ->> function_name) THEN
      CONTINUE; -- Already protected.
    ELSE
      RAISE EXCEPTION 'QA visibility: definition drift in %', function_name;
    END IF;
  END LOOP;
  FOR function_name IN SELECT jsonb_object_keys(baseline) LOOP
    SELECT pg_get_functiondef(p.oid) INTO definition
      FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = function_name AND p.pronargs = 0;
    IF definition IS NULL OR position(protected_filter IN definition) = 0
       OR md5(replace(definition, protected_filter, original_filter)) <> (baseline ->> function_name) THEN
      RAISE EXCEPTION 'QA visibility: postcondition failed for %', function_name;
    END IF;
  END LOOP;
END;
$qa_visibility$;
COMMIT;
