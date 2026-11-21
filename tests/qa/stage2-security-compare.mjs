import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const snapshotPath = process.argv[2];
if (!snapshotPath) throw new Error('PRODUCTION_SNAPSHOT_PATH_REQUIRED');

function unwrap(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) && parsed.length === 1 && parsed[0]?.security_snapshot
    ? parsed[0].security_snapshot
    : parsed?.security_snapshot ?? parsed;
}
function validate(snapshot, source) {
  if (snapshot?.effective_role !== 'authenticated' ||
      snapshot?.row_security !== 'on' || snapshot?.role_superuser !== false ||
      snapshot?.role_bypassrls !== false) throw new Error(`${source}_ROLE_UNSAFE`);
  for (const key of ['policies','tables','columns','constraints','indexes',
    'enum_types','triggers','functions','function_dependencies']) {
    if (!Array.isArray(snapshot[key])) throw new Error(`${source}_${key.toUpperCase()}_MISSING`);
  }
  return snapshot;
}
const production = validate(unwrap(readFileSync(snapshotPath,'utf8')),'PRODUCTION');
if (production.policies.length !== 21) throw new Error('PRODUCTION_POLICY_COUNT_UNEXPECTED');
const requiredTables = [
  'appointments','appointment_services','user_roles','staff','staff_services',
  'staff_time_off','booking_payment_requests','appointment_schedule_events',
  'services','studios','payment_intents','cash_register_movements',
];
const policyTables = new Set(requiredTables.slice(0,10));
const requiredFunctions = [
  'can_use_studio','has_privileged_studio_access','staff_owns_appointment',
  'financial_privacy_global_visible','studio_has_entitlement',
  'studio_staff_is_within_plan','studio_can_add_professional',
  'is_saas_owner','has_role','preview_studio_schedule_change',
  'move_studio_appointment','swap_studio_appointments',
  'create_manual_multi_professional_appointment',
];
for (const [source, snapshot] of [['PRODUCTION',production]]) {
  const tables = new Map(snapshot.tables.map((entry) => [entry.table,entry]));
  for (const name of requiredTables) {
    const table = tables.get(`public.${name}`);
    if (!table) throw new Error(`${source}_TABLE_MISSING_${name}`);
    if (policyTables.has(name) && !table.rls) {
      throw new Error(`${source}_RLS_DISABLED_${name}`);
    }
  }
  const functions = new Set(snapshot.functions.map((entry) =>
    entry.signature.replace(/^public\./,'').split('(')[0]));
  for (const name of requiredFunctions) {
    if (!functions.has(name)) throw new Error(`${source}_FUNCTION_MISSING_${name}`);
  }
}

const sql = readFileSync(new URL('./stage2-security-snapshot.readonly.sql', import.meta.url),'utf8');
const run = spawnSync('docker',['exec','-i','supabase_db_agenda-stage2-rls-qa',
  'psql','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],
  {input:sql,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
if (run.status !== 0) throw new Error('LOCAL_SECURITY_SNAPSHOT_UNAVAILABLE');
const local = validate(unwrap(run.stdout.trim()),'LOCAL');
const sections = ['policies','tables','columns','constraints','indexes',
  'enum_types','triggers','functions','function_dependencies'];
const differences = [];
for (const key of sections) {
  const normalize = (list) => list.map((item) => JSON.stringify(item)).sort();
  const actual = normalize(local[key]);
  const expected = normalize(production[key]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const detail = key === 'functions'
      ? production.functions.map((want) => {
          const got = local.functions.find((item) => item.signature === want.signature);
          return {signature:want.signature,fields:got
            ? Object.keys(want).filter((field) =>
                JSON.stringify(want[field]) !== JSON.stringify(got[field]))
            : ['missing']};
        }).filter((item) => item.fields.length)
      : undefined;
    differences.push({section:key,production:expected.length,local:actual.length,
      ...(detail ? {detail} : {})});
  }
}
if (production.server_version !== local.server_version) {
  differences.push({section:'server_version',production:production.server_version,
    local:local.server_version});
}
if (differences.length) {
  console.log(JSON.stringify({equivalent:false,differences}));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({equivalent:true,policies:local.policies.length,
    functions:local.functions.length,tables:local.tables.length}));
}
