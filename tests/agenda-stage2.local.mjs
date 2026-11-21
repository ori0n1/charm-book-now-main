import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const output = execFileSync('supabase', ['status', '--workdir', 'tmp/agenda-disposable', '-o', 'json'], { encoding: 'utf8' });
const local = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
assert.equal(local.API_URL, 'http://127.0.0.1:57921');
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const ownStudio = '11111111-1111-4111-8111-111111111111';
const otherStudio = '99999999-9999-4999-8999-999999999999';
const staffA = '33333333-3333-4333-8333-000000000001';
const staffB = '33333333-3333-4333-8333-000000000002';
const serviceA = '44444444-4444-4444-8444-000000000001';
const serviceB = '44444444-4444-4444-8444-000000000002';

async function check(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function createUser(role, studio, staffId) {
  const email = `agenda-stage2-${role}-${crypto.randomUUID()}@synthetic.invalid`;
  const password = `QA-${crypto.randomUUID()}!`;
  const created = await check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create user');
  await check(await admin.from('user_roles').insert({ user_id: created.user.id, studio_id: studio, role }), 'role');
  if (staffId) await check(await admin.from('staff').update({ user_id: created.user.id }).eq('id', staffId), 'staff identity');
  const client = createClient(local.API_URL, local.ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const session = await check(await client.auth.signInWithPassword({ email, password }), 'sign in');
  assert.equal(session.user.id, created.user.id);
  return { id: created.user.id, client };
}
async function booking({ start, duration, lines, studio = ownStudio, manualFit = false, price = 28 }) {
  const id = crypto.randomUUID();
  const firstStaff = lines[0].staffId;
  const end = new Date(Date.parse(start) + duration * 60_000).toISOString();
  await check(await admin.from('appointments').insert({ id, studio_id: studio,
    staff_id: firstStaff, starts_at: start, ends_at: end, total_price: price,
    total_duration_min: duration, is_manual_fit: manualFit,
    studio_commission_percent_snapshot: 23 }), 'booking');
  let cursor = Date.parse(start);
  const saved = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineStart = new Date(cursor).toISOString();
    cursor += line.durationMin * 60_000;
    const lineEnd = new Date(cursor).toISOString();
    const row = { id: crypto.randomUUID(), appointment_id: id, service_id: line.serviceId,
      staff_id: lines.length > 1 ? line.staffId : null,
      starts_at: lines.length > 1 ? lineStart : null,
      ends_at: lines.length > 1 ? lineEnd : null,
      position: lines.length > 1 ? index : null,
      duration_min: line.durationMin, price: line.price,
      studio_commission_percent_snapshot: 23,
      professional_commission_percent_snapshot: 37 };
    saved.push(row);
  }
  await check(await admin.from('appointment_services').insert(saved), 'booking lines');
  return { id, lines: saved };
}
function assignment(line, staffId = line.staff_id ?? staffA, durationMin = line.duration_min) {
  return { lineId: line.id, staffId, durationMin };
}
async function move(actorId, appointmentId, startsAt, assignments) {
  return admin.rpc('move_studio_appointment_stage2', {
    p_studio_id: ownStudio, p_appointment_id: appointmentId,
    p_starts_at: startsAt, p_assignments: assignments, p_actor_id: actorId,
  });
}
async function appointment(id) {
  return check(await admin.from('appointments').select('*').eq('id', id).single(), 'read booking');
}
async function lines(id) {
  return check(await admin.from('appointment_services').select('*').eq('appointment_id', id).order('position'), 'read lines');
}

const owner = await createUser('studio_owner', ownStudio);
const manager = await createUser('manager', ownStudio);
const professional = await createUser('staff', ownStudio, staffA);
const otherOwner = await createUser('studio_owner', otherStudio);
const target = await booking({ start: '2030-10-30T10:00:00Z', duration: 30,
  lines: [{ serviceId: serviceA, staffId: staffA, durationMin: 30, price: 28 }] });
const foreign = await booking({ start: '2030-10-30T10:00:00Z', duration: 30,
  studio: otherStudio, lines: [{ serviceId: serviceA, staffId: '33333333-3333-4333-8333-000000000009', durationMin: 30, price: 28 }] });

// Real authenticated JWTs pass through PostgREST RLS, independent of the service-role RPC.
const ownVisible = await check(await owner.client.from('appointments').select('id').eq('id', target.id), 'owner RLS');
const foreignHidden = await check(await owner.client.from('appointments').select('id').eq('id', foreign.id), 'cross studio RLS');
const otherHidden = await check(await otherOwner.client.from('appointments').select('id').eq('id', target.id), 'other owner RLS');
assert.equal(ownVisible.length, 1);
assert.equal(foreignHidden.length, 0);
assert.equal(otherHidden.length, 0);
const direct = await owner.client.rpc('move_studio_appointment_stage2', {
  p_studio_id: ownStudio, p_appointment_id: target.id, p_starts_at: '2030-10-30T10:00:00Z',
  p_assignments: [assignment(target.lines[0])], p_actor_id: owner.id,
});
assert.ok(direct.error, 'authenticated client cannot call service-role RPC');
assert.ok((await move(otherOwner.id, target.id, '2030-10-30T11:00:00Z', [assignment(target.lines[0])])).error,
  'actor from another studio is rejected');

// 1 and 2: duration grows and shrinks without touching the catalog or money.
const before = await appointment(target.id);
let result = await check(await move(owner.id, target.id, before.starts_at,
  [assignment(target.lines[0], staffA, 60)]), '30 to 60');
assert.equal(result.durationMin, 60);
assert.equal((await appointment(target.id)).total_duration_min, 60);
result = await check(await move(owner.id, target.id, before.starts_at,
  [assignment(target.lines[0], staffA, 30)]), '60 to 30');
assert.equal(result.durationMin, 30);

// 3: a free move; 4: automatic fit on overlap; then automatic removal when free.
result = await check(await move(manager.id, target.id, '2030-10-30T11:00:00Z',
  [assignment(target.lines[0])]), 'free slot');
assert.equal(result.isManualFit, false);
await booking({ start: '2030-10-30T12:00:00Z', duration: 60,
  lines: [{ serviceId: serviceA, staffId: staffA, durationMin: 60, price: 28 }] });
result = await check(await move(owner.id, target.id, '2030-10-30T12:00:00Z',
  [assignment(target.lines[0])]), 'overlap fit');
assert.equal(result.isManualFit, true);
assert.equal(result.autoFitCreated, true);
assert.equal((await appointment(target.id)).starts_at, '2030-10-30T12:00:00+00:00');
result = await check(await move(owner.id, target.id, '2030-10-30T13:00:00Z',
  [assignment(target.lines[0])]), 'automatic fit removal');
assert.equal(result.isManualFit, false);
assert.ok((await move(professional.id, target.id, '2030-10-30T12:00:00Z',
  [assignment(target.lines[0])])).error, 'professional cannot create an automatic fit');
assert.ok((await move(professional.id, target.id, '2030-10-30T13:30:00Z',
  [assignment(target.lines[0], staffB)])).error, 'professional cannot transfer the booking');
result = await check(await move(professional.id, target.id, '2030-10-30T13:30:00Z',
  [assignment(target.lines[0])]), 'professional own free slot');
assert.equal(result.isManualFit, false);
const intentionalFit = await booking({ start: '2030-10-30T16:00:00Z', duration: 30,
  manualFit: true, lines: [{ serviceId: serviceA, staffId: staffA, durationMin: 30, price: 28 }] });
result = await check(await move(owner.id, intentionalFit.id, '2030-10-30T16:30:00Z',
  [assignment(intentionalFit.lines[0])]), 'intentional fit retained');
assert.equal(result.isManualFit, true);

// 5 and 6: outside hours fits; a time-off block rolls back atomically.
result = await check(await move(owner.id, target.id, '2030-10-30T18:00:00Z',
  [assignment(target.lines[0])]), 'outside hours');
assert.equal(result.isManualFit, true);
await check(await admin.from('staff_time_off').insert({ id: crypto.randomUUID(), studio_id: ownStudio,
  staff_id: staffA, starts_at: '2030-10-30T14:00:00Z', ends_at: '2030-10-30T15:00:00Z' }), 'hard block');
const blocked = await move(owner.id, target.id, '2030-10-30T14:00:00Z', [assignment(target.lines[0])]);
assert.ok(blocked.error);
assert.equal((await appointment(target.id)).starts_at, '2030-10-30T18:00:00+00:00');

// 7: owner can move a free booking to an eligible professional.
result = await check(await move(owner.id, target.id, '2030-10-30T11:00:00Z',
  [assignment(target.lines[0], staffB)]), 'other professional');
assert.equal((await appointment(target.id)).staff_id, staffB);
assert.equal(result.isManualFit, false);

// 8: multi-service, multi-professional segments remain sequential and retain IDs.
const multi = await booking({ start: '2030-10-31T09:00:00Z', duration: 105, price: 68,
  lines: [
    { serviceId: serviceA, staffId: staffA, durationMin: 30, price: 28 },
    { serviceId: serviceB, staffId: staffB, durationMin: 60, price: 40 },
  ] });
await check(await admin.from('appointment_services')
  .update({ ends_at: '2030-10-31T09:45:00Z' }).eq('id', multi.lines[0].id), 'additional service time');
await check(await admin.from('appointment_services')
  .update({ starts_at: '2030-10-31T09:45:00Z', ends_at: '2030-10-31T10:45:00Z' })
  .eq('id', multi.lines[1].id), 'second segment after additional time');
const multiBefore = await lines(multi.id);
result = await check(await move(owner.id, multi.id, '2030-10-31T14:00:00Z', [
  assignment(multi.lines[0], staffA, 30), assignment(multi.lines[1], staffB, 90),
]), 'multi-professional');
const multiAfter = await lines(multi.id);
assert.equal(result.durationMin, 135);
assert.equal(multiAfter[0].ends_at, multiAfter[1].starts_at);
assert.equal(Date.parse(multiAfter[0].ends_at) - Date.parse(multiAfter[0].starts_at), 45 * 60_000);
assert.deepEqual(multiAfter.map((line) => line.id), multiBefore.map((line) => line.id));
assert.deepEqual(multiAfter.map((line) => line.service_id), multiBefore.map((line) => line.service_id));

// 9 and 10: failed mutation restores the previous state; finance and event history survive.
await check(await admin.from('payment_intents').insert({ id: crypto.randomUUID(), appointment_id: multi.id,
  status: 'succeeded' }), 'payment');
await check(await admin.from('cash_register_movements').insert({ id: crypto.randomUUID(), appointment_id: multi.id,
  amount: 15 }), 'deposit');
const paidBefore = await appointment(multi.id);
const paidLinesBefore = await lines(multi.id);
const rejectedStaffChange = await move(owner.id, multi.id, '2030-10-31T15:00:00Z', [
  assignment(multi.lines[0], staffB, 30), assignment(multi.lines[1], staffB, 90),
]);
assert.ok(rejectedStaffChange.error);
assert.equal((await appointment(multi.id)).starts_at, paidBefore.starts_at);
const paidDuration = await check(await move(owner.id, multi.id, '2030-10-31T14:00:00Z', [
  assignment(multi.lines[0], staffA, 30), assignment(multi.lines[1], staffB, 75),
]), 'paid duration only');
assert.equal(paidDuration.durationMin, 120);
const paidAfter = await appointment(multi.id);
const paidLinesAfter = await lines(multi.id);
assert.equal(paidAfter.total_price, paidBefore.total_price);
assert.equal(paidAfter.studio_commission_percent_snapshot, paidBefore.studio_commission_percent_snapshot);
assert.deepEqual(paidLinesAfter.map((line) => [line.price,line.studio_commission_percent_snapshot,
  line.professional_commission_percent_snapshot]), paidLinesBefore.map((line) => [line.price,
  line.studio_commission_percent_snapshot,line.professional_commission_percent_snapshot]));
assert.equal((await check(await admin.from('payment_intents').select('id').eq('appointment_id', multi.id), 'payments kept')).length, 1);
assert.equal((await check(await admin.from('cash_register_movements').select('id').eq('appointment_id', multi.id), 'deposits kept')).length, 1);
const history = await check(await admin.from('appointment_schedule_events').select('operation,next_state')
  .eq('appointment_id', target.id), 'history');
assert.ok(history.length >= 6);
assert.ok(history.some((event) => event.next_state?.manualFitAuto === true));
assert.equal((await check(await professional.client.from('appointments').select('id').eq('id', foreign.id), 'professional RLS')).length, 0);
console.log(JSON.stringify({ qa: 'local-disposable', cases: 10, passed: 10,
  rls: 'owner/manager/professional and cross-studio JWT checks passed',
  finance: 'price, commission snapshots, deposit and payment preserved',
  history: history.length }));
