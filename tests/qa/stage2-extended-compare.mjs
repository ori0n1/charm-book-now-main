import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const base = process.argv[2];
if (!base) throw new Error('QA_DIRECTORY_REQUIRED');
const names = ['security-snapshot.json','support-snapshot.partial.json',
  'support-snapshot.group2.json','support-snapshot.group4.json',
  'dependency-snapshot-1.json','dependency-snapshot-2.json',
  'dependency-snapshot-3.json'];
const snapshots = names.map((name) => JSON.parse(readFileSync(`${base}/${name}`,'utf8')));
for (const [index,snapshot] of snapshots.entries()) {
  if ((index === 1 || index === 2) && snapshot.effective_role === undefined) continue;
  if (snapshot.effective_role !== 'authenticated' || snapshot.role_bypassrls !== false ||
      snapshot.role_superuser !== false || snapshot.row_security !== 'on') {
    throw new Error('SOURCE_ROLE_UNSAFE');
  }
}
const keys = ['tables','columns','constraints','indexes','enum_types','triggers',
  'policies','functions','function_dependencies'];
const expected = Object.fromEntries(keys.map((key) =>
  [key,snapshots.flatMap((snapshot) => snapshot[key] || [])]));
const expectedTriggerFunctions = JSON.parse(readFileSync(`${base}/trigger-functions.json`,'utf8'));
const quote = (value) => `'${value.replaceAll("'","''")}'`;
const values = (items) => items.map((name) => `(${quote(name)})`).join(',');
const tableNames = expected.tables.map((row) => row.table.replace(/^public\./,''));
const policyNames = [...new Set(expected.policies.map((row) => row.table.replace(/^public\./,'')))];
const functionNames = [...new Set(expected.functions.map((row) => row.signature.split('(')[0]))];
let sql = readFileSync(new URL('./stage2-security-snapshot.readonly.sql',import.meta.url),'utf8');
sql = sql.replace(/scoped_tables\(name\) AS \([\s\S]*?\), policy_tables\(name\) AS \([\s\S]*?\), scoped_functions\(name\) AS \([\s\S]*?\), relations AS \(/,
  `scoped_tables(name) AS (VALUES ${values(tableNames)}), `+
  `policy_tables(name) AS (VALUES ${values(policyNames)}), `+
  `scoped_functions(name) AS (VALUES ${values(functionNames)}), relations AS (`);
const run = spawnSync('docker',['exec','-i','supabase_db_agenda-stage2-rls-qa',
  'psql','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],
  {input:sql,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
if (run.status !== 0) throw new Error(`QA_CATALOG_READ_FAILED: ${run.stderr.slice(0,300)}`);
const local = JSON.parse(run.stdout.trim());
if (local.effective_role !== 'authenticated' || local.role_bypassrls !== false ||
    local.role_superuser !== false || local.row_security !== 'on') throw new Error('QA_ROLE_UNSAFE');
const differences=[];
const triggerSql=`BEGIN READ ONLY; SET LOCAL ROLE authenticated;
SET LOCAL row_security=on;
SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
 'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
 'acl',p.proacl::text,'owner',pg_get_userbyid(p.proowner),
 'settings',p.proconfig,'security_definer',p.prosecdef) ORDER BY p.proname),
 '[]'::jsonb)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 (${expectedTriggerFunctions.map((row)=>quote(row.name)).join(',')}); ROLLBACK;`;
const triggerRun=spawnSync('docker',['exec','-i','supabase_db_agenda-stage2-rls-qa',
  'psql','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],
  {input:triggerSql,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
if(triggerRun.status!==0)throw new Error('QA_TRIGGER_CATALOG_READ_FAILED');
const actualTriggerFunctions=JSON.parse(triggerRun.stdout.trim());
const norm=(rows)=>rows.map((row)=>JSON.stringify(row)).sort();
if(JSON.stringify(norm(expectedTriggerFunctions))!==JSON.stringify(norm(actualTriggerFunctions))) {
  const actual=new Map(actualTriggerFunctions.map((row)=>[row.signature,row]));
  differences.push({section:'trigger_functions',source:expectedTriggerFunctions.length,
    qa:actualTriggerFunctions.length,
    mismatched:expectedTriggerFunctions.filter((row)=>
      JSON.stringify(row)!==JSON.stringify(actual.get(row.signature))).length});
}
for (const key of keys) {
  const normalize = (items) => items.map((item) => JSON.stringify(item)).sort();
  if (JSON.stringify(normalize(expected[key])) !== JSON.stringify(normalize(local[key]))) {
    const actualKeys = new Set(local[key].map((item) => JSON.stringify(item)));
    differences.push({section:key,source:expected[key].length,qa:local[key].length,
      mismatched:expected[key].filter((item) => !actualKeys.has(JSON.stringify(item))).length,
      ...(key === 'columns' ? {items:expected[key].filter((item) =>
        !actualKeys.has(JSON.stringify(item))).map((item) => ({table:item.table,name:item.name,
          fields:Object.keys(item).filter((field) => item[field] !==
            local[key].find((candidate) => candidate.table===item.table &&
              candidate.name===item.name)?.[field])}))} : {})});
  }
}
if (snapshots[0].server_version !== local.server_version) {
  differences.push({section:'server_version'});
}
console.log(JSON.stringify({equivalent:differences.length===0,tables:local.tables.length,
  policies:local.policies.length,functions:local.functions.length+actualTriggerFunctions.length,
  differences}));
if (differences.length) process.exitCode=1;
