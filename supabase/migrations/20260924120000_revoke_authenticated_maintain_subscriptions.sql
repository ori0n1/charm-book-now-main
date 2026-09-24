BEGIN;

DO $migration_guard$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RAISE EXCEPTION 'expected public.subscriptions to exist';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'unexpected authenticated privileges on public.subscriptions before MAINTAIN revoke';
  END IF;

  IF pg_has_role('authenticated', 'pg_maintain', 'MEMBER') THEN
    RAISE EXCEPTION 'authenticated inherits MAINTAIN through pg_maintain';
  END IF;

  IF has_table_privilege('anon', 'public.subscriptions', 'SELECT')
     OR has_table_privilege('anon', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('anon', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('anon', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('anon', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('anon', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('anon', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'unexpected anon privileges on public.subscriptions before MAINTAIN revoke';
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
    RAISE EXCEPTION 'unexpected PUBLIC privileges on public.subscriptions before MAINTAIN revoke';
  END IF;
END;
$migration_guard$;

REVOKE MAINTAIN
ON TABLE public.subscriptions
FROM authenticated;

DO $migration_verify$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'failed to preserve the expected authenticated privileges on public.subscriptions';
  END IF;
END;
$migration_verify$;

COMMIT;
