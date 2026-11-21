-- Run only through the authorized SQL Editor path. No business rows are read.
-- The transaction changes the effective role before reading catalog metadata.
BEGIN READ ONLY;
SET LOCAL ROLE authenticated;
SET LOCAL row_security = on;

WITH scoped_tables(name) AS (
  VALUES ('appointments'), ('appointment_services'), ('user_roles'),
    ('staff'), ('staff_services'), ('staff_time_off'),
    ('booking_payment_requests'), ('appointment_schedule_events'),
    ('services'), ('studios'), ('payment_intents'),
    ('cash_register_movements')
), policy_tables(name) AS (
  VALUES ('appointments'), ('appointment_services'), ('user_roles'),
    ('staff'), ('staff_services'), ('staff_time_off'),
    ('booking_payment_requests'), ('appointment_schedule_events'),
    ('services'), ('studios')
), scoped_functions(name) AS (
  VALUES ('can_use_studio'), ('has_privileged_studio_access'),
    ('staff_owns_appointment'), ('financial_privacy_global_visible'),
    ('studio_has_entitlement'), ('studio_staff_is_within_plan'),
    ('studio_can_add_professional'), ('is_saas_owner'), ('has_role'),
    ('preview_studio_schedule_change'), ('move_studio_appointment'),
    ('swap_studio_appointments'), ('create_manual_multi_professional_appointment')
), relations AS (
  SELECT c.oid, c.relname, c.relowner, c.relacl, c.relrowsecurity,
    c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN scoped_tables t ON t.name = c.relname
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
), routines AS (
  SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef,
    p.proconfig, p.provolatile, p.proparallel
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN scoped_functions f ON f.name = p.proname
  WHERE n.nspname = 'public'
)
SELECT jsonb_build_object(
  'effective_role', current_user,
  'row_security', current_setting('row_security'),
  'server_version', current_setting('server_version_num'),
  'role_superuser', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
  'role_bypassrls', (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user),
  'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table', schemaname || '.' || tablename, 'name', policyname,
    'permissive', permissive, 'roles', roles, 'command', cmd,
    'using', qual, 'check', with_check)
    ORDER BY schemaname, tablename, policyname), '[]'::jsonb)
    FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN (SELECT name FROM policy_tables)),
  'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || relname, 'owner', pg_get_userbyid(relowner),
    'rls', relrowsecurity, 'force_rls', relforcerowsecurity,
    'acl', relacl::text,
    'authenticated_select', has_table_privilege('authenticated',oid,'SELECT'),
    'authenticated_insert', has_table_privilege('authenticated',oid,'INSERT'),
    'authenticated_update', has_table_privilege('authenticated',oid,'UPDATE'),
    'authenticated_delete', has_table_privilege('authenticated',oid,'DELETE'),
    'anon_select', has_table_privilege('anon',oid,'SELECT'),
    'service_role_select', has_table_privilege('service_role',oid,'SELECT'),
    'service_role_update', has_table_privilege('service_role',oid,'UPDATE'))
    ORDER BY relname), '[]'::jsonb) FROM relations),
  'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || r.relname, 'name', a.attname,
    'ordinal', a.attnum, 'type', format_type(a.atttypid,a.atttypmod),
    'not_null', a.attnotnull, 'identity', a.attidentity,
    'generated', a.attgenerated,
    'default', pg_get_expr(d.adbin,d.adrelid))
    ORDER BY r.relname,a.attnum), '[]'::jsonb)
    FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid
      AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum),
  'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || r.relname, 'name', c.conname,
    'type', c.contype, 'definition', pg_get_constraintdef(c.oid,true))
    ORDER BY r.relname,c.conname), '[]'::jsonb)
    FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid),
  'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || r.relname, 'name', i.relname,
    'definition', pg_get_indexdef(i.oid))
    ORDER BY r.relname,i.relname), '[]'::jsonb)
    FROM relations r JOIN pg_index x ON x.indrelid=r.oid
    JOIN pg_class i ON i.oid=x.indexrelid),
  'enum_types', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name', n.nspname || '.' || t.typname,
    'labels', (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_enum e WHERE e.enumtypid=t.oid))
    ORDER BY n.nspname,t.typname), '[]'::jsonb)
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typtype='e'
      AND EXISTS (SELECT 1 FROM pg_attribute a JOIN relations r ON r.oid=a.attrelid
        WHERE a.atttypid=t.oid AND a.attnum>0 AND NOT a.attisdropped)),
  'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table', 'public.' || r.relname, 'name', t.tgname,
    'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid,true))
    ORDER BY r.relname,t.tgname), '[]'::jsonb)
    FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid
      AND NOT t.tgisinternal),
  'functions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'signature', oid::regprocedure::text, 'owner', pg_get_userbyid(proowner),
    'security_definer', prosecdef, 'settings', proconfig,
    'volatility', provolatile, 'parallel', proparallel,
    'acl', proacl::text, 'definition', pg_get_functiondef(oid),
    'authenticated_execute', has_function_privilege('authenticated',oid,'EXECUTE'),
    'anon_execute', has_function_privilege('anon',oid,'EXECUTE'),
    'service_role_execute', has_function_privilege('service_role',oid,'EXECUTE'))
    ORDER BY proname,oid::regprocedure::text), '[]'::jsonb) FROM routines),
  'function_dependencies', (SELECT coalesce(jsonb_agg(DISTINCT
    jsonb_build_object('function',r.oid::regprocedure::text,
      'depends_on',d.refobjid::regprocedure::text)), '[]'::jsonb)
    FROM routines r JOIN pg_depend d ON d.classid='pg_proc'::regclass
      AND d.objid=r.oid AND d.refclassid='pg_proc'::regclass)
) AS security_snapshot;

ROLLBACK;
