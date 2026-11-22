-- Run only after 20261122222600_owner_manager_free_fit.sql.
-- Catalog metadata only; no business rows or mutations.
BEGIN READ ONLY;
SET LOCAL ROLE authenticated;
SET LOCAL row_security = on;

WITH roles AS (
  SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
), functions AS (
  SELECT
    to_regprocedure('public.move_studio_appointment_stage2(uuid,uuid,timestamptz,jsonb,uuid,boolean)') AS move_oid,
    to_regprocedure('public.create_studio_manual_multi_professional_fit(uuid,jsonb,timestamptz,uuid,text,text,text,boolean,uuid,uuid[])') AS create_oid
)
SELECT current_user = 'authenticated' AND NOT rolsuper AND NOT rolbypassrls
    AND current_setting('transaction_read_only') = 'on' AS safe_reader,
  move_oid IS NOT NULL AND
    (SELECT md5(pg_get_functiondef(p.oid)) = '04322ec89fcd74651349d461e0d400bf'
     FROM pg_proc p WHERE p.oid = move_oid) AS six_arg_move_matches_qa,
  (SELECT p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
   FROM pg_proc p WHERE p.oid = move_oid) AS move_security_matches_qa,
  (SELECT md5(pg_get_functiondef(p.oid)) = 'f0adce8a98a4e377ccd9045dbd5f2580'
   FROM pg_proc p WHERE p.oid = create_oid) AS creation_rpc_unchanged
FROM roles, functions;

ROLLBACK;
