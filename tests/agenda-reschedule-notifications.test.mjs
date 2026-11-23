import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/studio-appointment.functions.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

function dispatcherWith(fakes) {
  const start = source.indexOf('async function dispatchRescheduleNotifications(');
  const end = source.indexOf('\nfunction normalizeAppointmentRelations(', start);
  assert.ok(start >= 0 && end > start, 'reschedule dispatcher must exist');
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(`${compiled}\ndispatchRescheduleNotifications`, {
    sendAppointmentLifecycleMessage: fakes.whatsapp,
    dispatchPendingStudioPushNotifications: fakes.push,
    notifyClientReschedule: fakes.client,
    console: { error: fakes.error },
  });
}

test('Stage 2 waits for reschedule notifications before returning', () => {
  const start = source.indexOf('export const moveStudioAppointmentStage2');
  const end = source.indexOf('export const swapStudioAppointments', start);
  assert.ok(start >= 0 && end > start, 'Stage 2 handler must exist');
  const handler = source.slice(start, end);
  assert.match(handler, /await dispatchRescheduleNotifications\(sb, data\.studioId, \[data\.appointmentId\]\)/);
  assert.doesNotMatch(handler, /deferRequestBackground|waitUntil/);
  assert.match(serverSource, /const response = await handler\.fetch\(request, env, ctx\)/);
  assert.doesNotMatch(serverSource, /withRequestBackground/);
});

test('normal reschedule completes all three existing channels before returning', async () => {
  const calls = [];
  const errors = [];
  let finishWhatsapp;
  const whatsappPending = new Promise((resolve) => { finishWhatsapp = resolve; });
  const dispatch = dispatcherWith({
    whatsapp: (_sb, _id, kind) => { calls.push(`whatsapp:${kind}`); return whatsappPending; },
    push: async () => { calls.push('studio_push'); },
    client: async () => { calls.push('client_center'); },
    error: (...args) => errors.push(args),
  });
  let completed = false;
  const pending = dispatch({}, 'studio-qa', ['appointment-qa']).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  finishWhatsapp();
  await pending;
  assert.deepEqual(calls, ['whatsapp:reschedule', 'studio_push', 'client_center']);
  assert.deepEqual(errors, []);
});

test('provider failure is recorded without suppressing other channels', async () => {
  const calls = [];
  const errors = [];
  const dispatch = dispatcherWith({
    whatsapp: async () => { calls.push('whatsapp'); },
    push: async () => { calls.push('studio_push'); throw new Error('synthetic provider failure'); },
    client: async () => { calls.push('client_center'); },
    error: (...args) => errors.push(args),
  });
  await dispatch({}, 'studio-qa', ['appointment-qa']);
  assert.deepEqual(calls, ['whatsapp', 'studio_push', 'client_center']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], '[agenda] reschedule notification failed');
  assert.equal(errors[0][1].channel, 'studio_push');
  assert.doesNotMatch(JSON.stringify(errors), /appointment-qa|synthetic provider failure/);
});
