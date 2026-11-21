import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Generates DDL for the disposable database from catalog metadata only.
// The output contains no business rows and must never target production.
const base = process.argv[2];
const out = process.argv[3];
if (!base || !out) throw new Error('USAGE: node stage2-build-local.mjs <qa-dir> <output.sql>');
const read = (name) => JSON.parse(readFileSync(`${base}/${name}`, 'utf8'));
const main = read('security-snapshot.json');
if (main.effective_role !== 'authenticated' || main.role_bypassrls ||
    main.role_superuser || main.policies.length !== 21) {
  throw new Error('PRODUCTION_SNAPSHOT_UNSAFE');
}
const support = read('support-snapshot.partial.json');
const group2 = read('support-snapshot.group2.json');
const baseOnly = process.argv.includes('--base-only');
if (!baseOnly && !existsSync(`${base}/dependency-snapshot-2.json`)) {
  throw new Error('TRANSITIVE_DEPENDENCY_SNAPSHOT_REQUIRED');
}
const group4 = baseOnly
  ? Object.fromEntries(['tables','columns','constraints','indexes','enum_types',
      'triggers','policies','functions'].map((key) => [key,[]]))
  : read('support-snapshot.group4.json');
const all = (key) => [...main[key], ...support[key], ...group2[key], ...group4[key]];
const tables = all('tables');
const columns = all('columns');
const constraints = all('constraints');
const enumTypes = all('enum_types');
const signatures = new Set(tables.map((t) => t.table));
if (signatures.size !== (baseOnly ? 24 : 28)) throw new Error('UNEXPECTED_TABLE_COUNT');
const ident = (value) => `"${value.replaceAll('"', '""')}"`;
const lit = (value) => `'${value.replaceAll("'", "''")}'`;
const lines = ['BEGIN;', 'CREATE EXTENSION IF NOT EXISTS btree_gist;',
  'SET LOCAL check_function_bodies = off;',
  'SET LOCAL search_path = public, pg_temp;'];

for (const type of enumTypes) {
  lines.push(`CREATE TYPE ${type.name} AS ENUM (${type.labels.map(lit).join(', ')});`);
}
for (const table of tables) {
  const cols = columns.filter((c) => c.table === table.table)
    .sort((a,b) => a.ordinal-b.ordinal).map((c) => {
      let sql = `${ident(c.name)} ${c.type}`;
      if (c.default) sql += ` DEFAULT ${c.default}`;
      if (c.not_null) sql += ' NOT NULL';
      return sql;
    });
  lines.push(`CREATE TABLE ${table.table} (\n  ${cols.join(',\n  ')}\n);`);
}
const functions = [...main.functions, ...read('trigger-functions.json'),...group4.functions];
for (const func of functions) lines.push(`${func.definition};`);

// First add keys needed by foreign keys, then remaining constraints.
const keys = constraints.filter((c) => c.type === 'p' || c.type === 'u');
const remaining = [...main.constraints,...group4.constraints]
  .filter((c) => c.type !== 'p' && c.type !== 'u');
for (const c of keys) {
  lines.push(`ALTER TABLE ${c.table} ADD CONSTRAINT ${ident(c.name)} ${c.definition};`);
}
const indexedConstraintNames = new Set([...keys, ...remaining.filter(c=>c.type==='x')]
  .map(c => c.name));
for (const index of [...support.indexes,...group2.indexes,...group4.indexes]) {
  if (!indexedConstraintNames.has(index.name)) lines.push(`${index.definition};`);
}
for (const index of main.indexes) {
  if (!indexedConstraintNames.has(index.name)) lines.push(`${index.definition};`);
}
for (const c of [...remaining.filter(c => c.type !== 'f'),
  ...remaining.filter(c => c.type === 'f')]) {
  lines.push(`ALTER TABLE ${c.table} ADD CONSTRAINT ${ident(c.name)} ${c.definition};`);
}
for (const table of tables) {
  if (table.rls) lines.push(`ALTER TABLE ${table.table} ENABLE ROW LEVEL SECURITY;`);
  if (table.force_rls) lines.push(`ALTER TABLE ${table.table} FORCE ROW LEVEL SECURITY;`);
}
for (const policy of [...main.policies,...group4.policies]) {
  const roles = policy.roles.map(ident).join(', ');
  let sql = `CREATE POLICY ${ident(policy.name)} ON ${policy.table} AS ${policy.permissive}`+
    ` FOR ${policy.command} TO ${roles}`;
  if (policy.using) sql += ` USING (${policy.using})`;
  if (policy.check) sql += ` WITH CHECK (${policy.check})`;
  lines.push(`${sql};`);
}
for (const trigger of [...main.triggers,...group4.triggers]) {
  lines.push(`${trigger.definition};`);
  if (trigger.enabled !== 'O') {
    lines.push(`ALTER TABLE ${trigger.table} ${trigger.enabled==='D'?'DISABLE':'ENABLE REPLICA'} TRIGGER ${ident(trigger.name)};`);
  }
}
const privilegeMap = {a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',
  x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',X:'EXECUTE'};
function replayAcl(kind, target, acl) {
  lines.push(`REVOKE ALL ON ${kind} ${target} FROM PUBLIC, postgres, anon, authenticated, service_role;`);
  if (!acl) return;
  for (const entry of acl.slice(1,-1).split(',')) {
    const match = entry.match(/^([^=]*)=([^/]*)\//);
    if (!match) throw new Error(`UNEXPECTED_ACL_${target}`);
    const principal = match[1] ? ident(match[1]) : 'PUBLIC';
    const privileges = [...match[2]].filter(c => c !== '*').map(c => privilegeMap[c]);
    if (privileges.some(x => !x)) throw new Error(`UNKNOWN_PRIVILEGE_${target}`);
    if (privileges.length) lines.push(`GRANT ${privileges.join(', ')} ON ${kind} ${target} TO ${principal};`);
  }
}
for (const table of tables) replayAcl('TABLE', table.table, table.acl);
for (const func of [...main.functions,...group4.functions]) {
  replayAcl('FUNCTION', `public.${func.signature}`, func.acl);
}
lines.push('COMMIT;');
writeFileSync(out, lines.join('\n')+'\n', {flag:'w'});
console.log(JSON.stringify({ddl_file:out,tables:tables.length,
  policies:main.policies.length+group4.policies.length,
  functions:functions.length,triggers:main.triggers.length+group4.triggers.length}));
