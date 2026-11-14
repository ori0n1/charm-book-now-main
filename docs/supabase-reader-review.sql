-- BELLZA: proposta para revisão humana. Não executado pela Codex.
-- Projeto esperado: pwmdzpvnatrvfpgcvnzg (produção).
-- Ler apenas catálogos. Nenhuma linha de cliente, reserva ou pagamento.
BEGIN READ ONLY;

SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb,
       rolcreaterole, rolreplication, rolinherit,
       (SELECT count(*) FROM pg_catalog.pg_auth_members m
        WHERE m.member = r.oid) AS memberships
FROM pg_catalog.pg_roles r
WHERE rolname = 'bellza_catalog_reader';

SELECT
  (SELECT count(*) FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT LIKE 'pg_%'
     AND n.nspname <> 'information_schema'
     AND c.relkind IN ('r','p','v','f')
     AND has_schema_privilege('bellza_catalog_reader', n.oid, 'USAGE')
     AND (has_table_privilege('bellza_catalog_reader', c.oid, 'INSERT')
       OR has_table_privilege('bellza_catalog_reader', c.oid, 'UPDATE')
       OR has_table_privilege('bellza_catalog_reader', c.oid, 'DELETE')
       OR has_table_privilege('bellza_catalog_reader', c.oid, 'TRUNCATE')))
    AS writable_tables,
  (SELECT count(*) FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT LIKE 'pg_%'
     AND n.nspname <> 'information_schema'
     AND c.relkind = 'S'
     AND has_schema_privilege('bellza_catalog_reader', n.oid, 'USAGE')
     AND (has_sequence_privilege('bellza_catalog_reader', c.oid, 'USAGE')
       OR has_sequence_privilege('bellza_catalog_reader', c.oid, 'UPDATE')))
    AS writable_sequences,
  (SELECT count(*) FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT LIKE 'pg_%'
     AND n.nspname <> 'information_schema'
     AND p.prosecdef
     AND has_schema_privilege('bellza_catalog_reader', n.oid, 'USAGE')
     AND has_function_privilege('bellza_catalog_reader', p.oid, 'EXECUTE'))
    AS executable_security_definer_routines,
  has_database_privilege('bellza_catalog_reader', current_database(),
    'CREATE') AS can_create_in_database;

SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity,
       p.polname, p.polcmd, p.polpermissive,
       pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
WHERE n.nspname NOT LIKE 'pg_%'
  AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r','p')
  AND c.relname ~* '(agenda|appoint|reserv|book|studio)'
ORDER BY n.nspname, c.relname, p.polname;

ROLLBACK;
