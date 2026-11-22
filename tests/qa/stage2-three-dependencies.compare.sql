-- Read only catalog fingerprint for the three Stage 2 UI dependencies.
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'refund_trigger_function', (
    SELECT pg_get_functiondef(p.oid) FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='notify_refund_request_created'
  ),
  'tables', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname, 'kind', c.relkind, 'owner', pg_get_userbyid(c.relowner),
      'acl', c.relacl::text, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'name', a.attname, 'type', format_type(a.atttypid,a.atttypmod),
        'not_null', a.attnotnull, 'default', pg_get_expr(ad.adbin,ad.adrelid),
        'identity', a.attidentity, 'generated', a.attgenerated, 'acl', a.attacl::text
      ) ORDER BY a.attnum),'[]'::jsonb) FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'name', con.conname, 'type', con.contype, 'definition', pg_get_constraintdef(con.oid)
      ) ORDER BY con.conname),'[]'::jsonb) FROM pg_catalog.pg_constraint con WHERE con.conrelid=c.oid),
      'indexes', (SELECT coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid),'[]'::jsonb)
        FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid),
      'policies', (SELECT coalesce(jsonb_agg(to_jsonb(pol) ORDER BY pol.policyname),'[]'::jsonb)
        FROM pg_catalog.pg_policies pol WHERE pol.schemaname='public' AND pol.tablename=c.relname),
      'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'name', t.tgname, 'definition', pg_get_triggerdef(t.oid),
        'function', t.tgfoid::regprocedure::text, 'enabled', t.tgenabled
      ) ORDER BY t.tgname),'[]'::jsonb) FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
      'grants', jsonb_build_object(
        'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
        'anon_insert',has_table_privilege('anon',c.oid,'INSERT'),
        'anon_update',has_table_privilege('anon',c.oid,'UPDATE'),
        'anon_delete',has_table_privilege('anon',c.oid,'DELETE'),
        'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
        'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
        'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
        'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE'),
        'service_role_select',has_table_privilege('service_role',c.oid,'SELECT'),
        'service_role_insert',has_table_privilege('service_role',c.oid,'INSERT'),
        'service_role_update',has_table_privilege('service_role',c.oid,'UPDATE'),
        'service_role_delete',has_table_privilege('service_role',c.oid,'DELETE'))
    ) ORDER BY c.relname),'[]'::jsonb)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('refund_requests','whatsapp_message_logs')
  ),
  'functions', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
      'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
      'security_definer',p.prosecdef,'volatility',p.provolatile,
      'parallel',p.proparallel,'settings',p.proconfig,
      'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_role_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'dependencies',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'refclass',d.refclassid::regclass::text,
        'object',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),
        'kind',d.deptype)),'[]'::jsonb) FROM pg_catalog.pg_depend d
        WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid)
    ) ORDER BY p.oid::regprocedure::text),'[]'::jsonb)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='resolve_studio_local_datetime'
  )
) AS dependency_snapshot;
ROLLBACK;
