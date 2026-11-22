-- Allow a manager of the same studio to use the existing manual-fit override.
-- The published RPC signature, financial logic, payment holds and grants stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  v_rpc regprocedure := to_regprocedure(
    'public.create_studio_manual_multi_professional_fit(uuid,jsonb,timestamptz,uuid,text,text,text,boolean,uuid,uuid[])');
  v_definition text;
  v_acl aclitem[];
  v_owner oid;
  v_security_definer boolean;
  v_settings text[];
  v_role_check constant text := 'role IN (''studio_owner'', ''saas_owner'')';
BEGIN
  IF v_rpc IS NULL THEN RAISE EXCEPTION 'manual_fit_rpc_missing'; END IF;
  SELECT pg_get_functiondef(p.oid), p.proacl, p.proowner, p.prosecdef, p.proconfig
    INTO STRICT v_definition, v_acl, v_owner, v_security_definer, v_settings
    FROM pg_proc AS p WHERE p.oid = v_rpc;
  -- Hash of the effective definition read with authenticated, non-BYPASSRLS role
  -- and reproduced byte-for-byte in disposable QA before this migration.
  IF md5(v_definition) <> 'f0adce8a98a4e377ccd9045dbd5f2580'
    OR v_security_definer IS NOT TRUE
    OR (length(v_definition) - length(replace(v_definition, v_role_check, '')))
      / length(v_role_check) <> 1 THEN
    RAISE EXCEPTION 'manual_fit_rpc_definition_changed';
  END IF;
  EXECUTE replace(v_definition, v_role_check,
    'role IN (''studio_owner'', ''saas_owner'', ''manager'')');
  IF EXISTS (SELECT 1 FROM pg_proc AS p WHERE p.oid = v_rpc
    AND (p.proacl IS DISTINCT FROM v_acl
      OR p.proowner IS DISTINCT FROM v_owner
      OR p.prosecdef IS DISTINCT FROM v_security_definer
      OR p.proconfig IS DISTINCT FROM v_settings)) THEN
    RAISE EXCEPTION 'manual_fit_rpc_security_changed';
  END IF;
END;
$migration$;

COMMIT;
