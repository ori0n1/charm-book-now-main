-- Bellza / revisao direcionada de metadados na producao pwmdzpvnatrvfpgcvnzg.
-- SOMENTE SELECT de catalogos. Nao executado pela Codex.
-- Executar cada SELECT separadamente numa sessao administrativa ja autorizada.
-- Nao consultar linhas de agenda, reservas, clientes ou pagamentos.

-- 1. Role usada pela Data API e estado de RLS/grants das quatro tabelas.
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
       n.nspname AS schema_name, c.relname AS table_name, c.relkind,
       c.relowner::regrole::text AS owner_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.relacl::text AS explicit_acl,
       has_schema_privilege(r.rolname, n.oid, 'USAGE') AS schema_usage,
       has_table_privilege(r.rolname, c.oid, 'SELECT') AS table_select
FROM pg_catalog.pg_roles r
CROSS JOIN pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE r.rolname = 'authenticated'
  AND n.nspname = 'public'
  AND c.relname IN ('appointments', 'booking_payment_requests', 'studios', 'user_roles')
ORDER BY c.relname;

-- 2. Colunas predefinidas que o adaptador podera selecionar.
WITH wanted(table_name, column_name) AS (
  VALUES ('appointments','studio_id'), ('appointments','status'),
         ('appointments','starts_at'),
         ('booking_payment_requests','studio_id'),
         ('booking_payment_requests','status'),
         ('booking_payment_requests','created_at'),
         ('studios','id'), ('studios','is_active'),
         ('user_roles','user_id'), ('user_roles','studio_id'),
         ('user_roles','role')
)
SELECT w.table_name, w.column_name, a.attnum IS NOT NULL AS column_exists,
       a.attgenerated AS generated_kind,
       CASE WHEN a.attnum IS NULL THEN false ELSE
         has_column_privilege('authenticated', c.oid, a.attname, 'SELECT')
       END AS can_select
FROM wanted w
LEFT JOIN pg_catalog.pg_class c
  ON c.relname = w.table_name AND c.relnamespace = 'public'::regnamespace
LEFT JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid AND a.attname = w.column_name
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY w.table_name, w.column_name;

-- 3. Politicas ativas: expressao e roles, sem dados de negocio.
SELECT c.relname AS table_name, p.polname AS policy_name,
       p.polcmd AS command, p.polpermissive AS permissive,
       ARRAY(SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC'
                         ELSE role_oid::regrole::text END
             FROM unnest(p.polroles) AS x(role_oid)) AS policy_roles,
       pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
FROM pg_catalog.pg_policy p
JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('appointments', 'booking_payment_requests', 'studios', 'user_roles')
ORDER BY c.relname, p.polname;

-- 4. Funcoes referenciadas pelas politicas segundo o catalogo. A ausencia
-- de dependencia catalogada NAO prova ausencia de chamadas indiretas.
SELECT c.relname AS table_name, pol.polname AS policy_name,
       proc.oid::regprocedure::text AS routine_signature,
       proc.proowner::regrole::text AS owner_name,
       proc.prosecdef AS security_definer,
       proc.provolatile AS volatility,
       has_function_privilege('authenticated', proc.oid, 'EXECUTE') AS callable,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) AS definition_fingerprint
FROM pg_catalog.pg_policy pol
JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
JOIN pg_catalog.pg_depend dep
  ON dep.classid = 'pg_policy'::regclass AND dep.objid = pol.oid
  AND dep.refclassid = 'pg_proc'::regclass
JOIN pg_catalog.pg_proc proc ON proc.oid = dep.refobjid
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('appointments', 'booking_payment_requests', 'studios', 'user_roles')
ORDER BY c.relname, pol.polname, routine_signature;

-- 5. Pre-request hook da Data API, se definido por role/database.
-- A funcao configurada tambem deve ser revista quanto a efeitos colaterais.
SELECT COALESCE(r.rolname, 'ALL') AS role_name,
       COALESCE(d.datname, 'ALL') AS database_name,
       cfg.setting AS pre_request_setting
FROM pg_catalog.pg_db_role_setting s
LEFT JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
LEFT JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
CROSS JOIN LATERAL unnest(s.setconfig) AS cfg(setting)
WHERE cfg.setting LIKE 'pgrst.db_pre_request=%'
ORDER BY role_name, database_name;

-- Definicoes completas de funcoes referenciadas pelas politicas devem ser
-- revistas dentro do SQL Editor autorizado; nao exportar bodies com secrets.
-- Politicas e fingerprints precisam ser comparados novamente imediatamente
-- antes de uma primeira leitura real. O catalogo nao prova isolamento sozinho.
