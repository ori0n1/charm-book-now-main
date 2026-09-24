BEGIN;

DO $rollback_guard$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RAISE EXCEPTION 'expected public.subscriptions to exist';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'unexpected authenticated privileges on public.subscriptions before MAINTAIN rollback';
  END IF;

  IF pg_has_role('authenticated', 'pg_maintain', 'MEMBER') THEN
    RAISE EXCEPTION 'authenticated inherits MAINTAIN through pg_maintain';
  END IF;
END;
$rollback_guard$;

GRANT MAINTAIN
ON TABLE public.subscriptions
TO authenticated;

DO $rollback_verify$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.subscriptions', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'DELETE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.subscriptions', 'TRIGGER') THEN
    RAISE EXCEPTION 'failed to restore the expected authenticated privileges on public.subscriptions';
  END IF;
END;
$rollback_verify$;

COMMIT;
