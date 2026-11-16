-- PROPOSAL ONLY. Do not run without separate authorization for a production DB change.
-- Six live private.catalog_public_* bodies were read on 2026-11-16.
-- Replace exactly one active-studio predicate in each function, preserving
-- signature, owner, grants, SECURITY DEFINER, search_path, returned columns,
-- and all real studios. Review other public entry points before QA B activation.
BEGIN;
DO $qa_visibility$
DECLARE
  function_name text;
  function_oid oid;
  is_definer boolean;
  volatility "char";
  original_definition text;
  previous_filter text := 'studio.is_active = true';
  protected_filter text := 'studio.is_active = true AND studio.id NOT IN (''e2663064-7774-41c5-95cb-e5e6afc4fab4''::uuid, ''2cc1683e-ab91-4488-a702-6a8feb60f379''::uuid)';
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'catalog_public_service_categories', 'catalog_public_services',
    'catalog_public_staff', 'catalog_public_staff_services',
    'catalog_public_studios', 'catalog_public_upsell_offers'
  ] LOOP
    SELECT p.oid, p.prosecdef, p.provolatile
      INTO function_oid, is_definer, volatility
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = function_name
        AND p.pronargs = 0;
    IF function_oid IS NULL OR is_definer IS DISTINCT FROM true OR volatility <> 's' THEN
      RAISE EXCEPTION 'QA visibility: function % changed or missing', function_name;
    END IF;
    original_definition := pg_get_functiondef(function_oid);
    IF original_definition IS NULL
       OR length(original_definition) - length(replace(original_definition, previous_filter, '')) <> length(previous_filter)
       OR position(protected_filter IN original_definition) > 0 THEN
      RAISE EXCEPTION 'QA visibility: function % differs; inspect before any change', function_name;
    END IF;
    EXECUTE replace(original_definition, previous_filter, protected_filter);
  END LOOP;
END;
$qa_visibility$;
-- Safe default: rollback the transaction. A separately approved release must
-- replace this final line with COMMIT only after preflight and validation of
-- the six functions, direct anon reads, and representative real studios.
ROLLBACK;
