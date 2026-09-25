BEGIN;

DO $migration_guard$
DECLARE
  subscriptions_owner text;
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RAISE EXCEPTION 'expected public.subscriptions to exist';
  END IF;

  SELECT pg_get_userbyid(relation.relowner)
  INTO subscriptions_owner
  FROM pg_class AS relation
  WHERE relation.oid = 'public.subscriptions'::regclass;

  IF subscriptions_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'unexpected owner for public.subscriptions';
  END IF;

  IF NOT has_table_privilege('anon', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('anon', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('anon', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('anon', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('anon', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('anon', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'unexpected anon privileges on public.subscriptions before revoke';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, '{}'::aclitem[])) AS acl
    JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'subscriptions'
      AND grantee.rolname = 'anon'
      AND acl.privilege_type = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, '{}'::aclitem[])) AS acl
    JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'subscriptions'
      AND grantee.rolname = 'anon'
      AND acl.privilege_type = 'MAINTAIN'
  ) THEN
    RAISE EXCEPTION 'expected direct anon SELECT and MAINTAIN grants on public.subscriptions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, '{}'::aclitem[])) AS acl
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'subscriptions'
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'unexpected PUBLIC privileges on public.subscriptions before revoke';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'unexpected authenticated privileges on public.subscriptions before anon revoke';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'MAINTAIN')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'TRUNCATE')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'REFERENCES')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'unexpected service_role privileges on public.subscriptions before anon revoke';
  END IF;

  IF NOT has_table_privilege('postgres', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'MAINTAIN')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'INSERT')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'UPDATE')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'DELETE')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'TRUNCATE')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'REFERENCES')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'unexpected postgres privileges on public.subscriptions before anon revoke';
  END IF;
END;
$migration_guard$;

REVOKE SELECT, MAINTAIN
ON TABLE public.subscriptions
FROM anon;

DO $migration_verify$
DECLARE
  subscriptions_owner text;
BEGIN
  IF has_table_privilege('anon', 'public.subscriptions', 'SELECT')
     OR has_table_privilege('anon', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('anon', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('anon', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('anon', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('anon', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('anon', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'failed to remove all effective anon privileges on public.subscriptions';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'failed to preserve authenticated privileges on public.subscriptions';
  END IF;

  SELECT pg_get_userbyid(relation.relowner)
  INTO subscriptions_owner
  FROM pg_class AS relation
  WHERE relation.oid = 'public.subscriptions'::regclass;

  IF subscriptions_owner IS DISTINCT FROM 'postgres'
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'MAINTAIN')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'TRUNCATE')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'REFERENCES')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'TRIGGER')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'MAINTAIN')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'INSERT')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'UPDATE')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'DELETE')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'TRUNCATE')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'REFERENCES')
     OR NOT has_table_privilege('postgres', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'owner or trusted-role privileges changed during anon revoke';
  END IF;
END;
$migration_verify$;

COMMIT;
