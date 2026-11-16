-- PROPOSAL ONLY. Requires a separate rollback authorization.
-- Deliberately blocked while QA A or QA B is active: restoring the prior
-- catalog definitions would expose those studios to anonymous visitors.
BEGIN;
DO $qa_visibility_rollback$
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
  definition text;
  original_filter text := 'studio.is_active = true';
  protected_filter text := 'studio.is_active = true AND studio.id NOT IN (''e2663064-7774-41c5-95cb-e5e6afc4fab4''::uuid, ''2cc1683e-ab91-4488-a702-6a8feb60f379''::uuid)';
BEGIN
  IF EXISTS (SELECT 1 FROM public.studios
    WHERE id IN ('e2663064-7774-41c5-95cb-e5e6afc4fab4'::uuid,
                 '2cc1683e-ab91-4488-a702-6a8feb60f379'::uuid)
      AND is_active = true) THEN
    RAISE EXCEPTION 'QA visibility: rollback would expose an active QA studio';
  END IF;
  FOR function_name IN SELECT jsonb_object_keys(baseline) LOOP
    SELECT p.oid INTO function_oid
      FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = function_name AND p.pronargs = 0;
    IF function_oid IS NULL THEN RAISE EXCEPTION 'QA visibility: missing %', function_name; END IF;
    definition := pg_get_functiondef(function_oid);
    IF md5(definition) = (baseline ->> function_name) THEN
      CONTINUE; -- Already restored.
    ELSIF position(protected_filter IN definition) > 0
       AND md5(replace(definition, protected_filter, original_filter)) = (baseline ->> function_name) THEN
      EXECUTE replace(definition, protected_filter, original_filter);
    ELSE
      RAISE EXCEPTION 'QA visibility: definition drift in %', function_name;
    END IF;
  END LOOP;
  FOR function_name IN SELECT jsonb_object_keys(baseline) LOOP
    SELECT pg_get_functiondef(p.oid) INTO definition
      FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = function_name AND p.pronargs = 0;
    IF definition IS NULL OR md5(definition) <> (baseline ->> function_name) THEN
      RAISE EXCEPTION 'QA visibility: rollback postcondition failed for %', function_name;
    END IF;
  END LOOP;
END;
$qa_visibility_rollback$;
COMMIT;
