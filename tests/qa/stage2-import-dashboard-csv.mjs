import { readFileSync, writeFileSync } from 'node:fs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error('USAGE: node stage2-import-dashboard-csv.mjs <source.csv> <destination.json>');
}
const csv = readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
const separator = csv.indexOf('\n');
if (separator < 0 || csv.slice(0,separator).trim().replaceAll('"','') !== 'security_snapshot') {
  throw new Error('UNEXPECTED_CSV_HEADER');
}
let cell = csv.slice(separator+1).trim();
if (cell.startsWith('"') && cell.endsWith('"')) {
  cell = cell.slice(1,-1).replaceAll('""','"');
}
const snapshot = JSON.parse(cell);
const expectedTables = new Set(['public.customer_loyalty_rewards','public.referrals']);
const expectedFunctions = new Set([
  'correct_customer_referral_existing_client', 'customer_loyalty_begin_service_rule',
  'customer_loyalty_begin_visit_rule', 'enforce_notification_log_appointment_tenant',
  'notify_studio_new_review', 'refresh_studio_rating',
]);
const triggerOnly = destination.endsWith('dependency-snapshot-3.json');
if (triggerOnly) {
  expectedTables.clear();
  expectedFunctions.clear();
  expectedFunctions.add('customer_loyalty_snapshot_reward_timing');
}
if (snapshot.effective_role !== 'authenticated' || snapshot.role_superuser !== false ||
    snapshot.role_bypassrls !== false || snapshot.row_security !== 'on' ||
    (triggerOnly ? !snapshot.functions || snapshot.functions.length !== 1 :
      snapshot.tables?.length !== 2 || snapshot.functions?.length !== 6) ||
    !(snapshot.tables || []).every((row) => expectedTables.has(row.table)) ||
    !snapshot.functions.every((row) => expectedFunctions.has(row.signature.split('(')[0]))) {
  throw new Error('SNAPSHOT_SCOPE_OR_ROLE_UNEXPECTED');
}
const definitions = snapshot.functions.map((row) => row.definition).join('\n').toLowerCase();
if (/(?:password|secret|apikey|api_key|authorization|https?:\/\/)/.test(definitions)) {
  throw new Error('REVIEW_FUNCTION_DEFINITIONS_BEFORE_STORAGE');
}
writeFileSync(destination,JSON.stringify(snapshot),{flag:'wx'});
console.log(JSON.stringify({imported:true,tables:snapshot.tables?.length || 0,
  policies:snapshot.policies?.length || 0,functions:snapshot.functions.length,
  triggers:snapshot.triggers?.length || 0,columns:snapshot.columns?.length || 0}));
