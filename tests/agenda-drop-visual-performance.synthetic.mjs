import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const path = 'src/routes/_authenticated/admin.agenda.tsx';
const baseline = execFileSync('git', ['show', `c518959:${path}`], { encoding: 'utf8' });
const candidate = readFileSync(path, 'utf8');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const oldStart = '2030-10-30T10:00:00.000Z';
const oldEnd = '2030-10-30T11:00:00.000Z';
const newStart = '2030-10-30T11:00:00.000Z';
const newEnd = '2030-10-30T12:00:00.000Z';

function loadDrop(source, context) {
  const helper = source.indexOf('  function commitScheduleResult(');
  const start = helper >= 0 ? helper : source.indexOf('  async function prepareDraggedAppointment(');
  const end = source.indexOf('\n  return (', start);
  assert.ok(start >= 0 && end > start);
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`${javascript}\nthis.drop = prepareDraggedAppointment;`, context);
  return context.drop;
}

async function measure(source) {
  let appointments = [{ id: 'appointment-a', starts_at: oldStart, ends_at: oldEnd,
    status: 'confirmed', staff: { id: 'staff-a' }, appointment_services: [{ id: 'line-a',
      services: { id: 'service-a' }, staff: { id: 'staff-a' }, starts_at: oldStart, ends_at: oldEnd }] }];
  let visualMs;
  let reloads = 0;
  const context = {
    studio: { id: 'studio-a', role: 'studio_owner' }, appts: appointments,
    agendaStaff: [{ id: 'staff-a', name: 'QA profissional' }],
    selectedDate: new Date('2030-10-30T00:00:00Z'), paidByAppointment: new Map(),
    pendingDropMovesRef: { current: new Set() }, agendaLoadSequenceRef: { current: 0 },
    setAppts: (update) => {
      appointments = update(appointments);
      if (visualMs === undefined && appointments[0].starts_at === newStart) {
        visualMs = performance.now() - started;
      }
    },
    setLoading: () => {}, toDateInputValue: () => '2030-10-30',
    loadDropCatalog: async () => { await delay(35); return { links: [], staff: [] }; },
    resolveDropDateTime: async () => { await delay(30); return { startsAt: newStart }; },
    previewDropSchedule: async () => { await delay(30); return { staffAvailable: true,
      paymentHolds: [], hardBlocked: false, withinAvailability: true, hasConflict: false }; },
    moveDroppedAppointment: async () => { await delay(160); return { changed: true,
      appointmentId: 'appointment-a', startsAt: newStart, endsAt: newEnd,
      durationMin: 60, isManualFit: false,
      services: [{ id: 'line-a', staffId: 'staff-a', startsAt: newStart,
        endsAt: newEnd, durationMin: 60 }] }; },
    loadData: async () => { reloads++; await delay(50); },
    toast: { error: () => {}, info: () => {}, success: () => {} },
    scheduleChangeMessage: (error) => error.message,
    isManualAppointmentServiceAllowed: () => true,
    setDropRescheduleDraft: () => {}, setRescheduleServiceLineId: () => {},
    setRescheduleApptId: () => {}, setDropEditDraft: () => {}, setEditApptId: () => {},
    Date, Math, String, Promise, Set,
  };
  const drop = loadDrop(source, context);
  const started = performance.now();
  await drop({ id: 'appointment-a', startsAt: oldStart, endsAt: oldEnd }, 'staff-a', 660);
  assert.equal(appointments[0].starts_at, newStart);
  return { visualMs, reloads };
}

const before = [];
const after = [];
for (let i = 0; i < 3; i++) {
  before.push(await measure(baseline));
  after.push(await measure(candidate));
}
const median = (numbers) => [...numbers].sort((a, b) => a - b)[1];
const beforeMs = median(before.map((sample) => sample.visualMs));
const afterMs = median(after.map((sample) => sample.visualMs));
assert.ok(afterMs < beforeMs - 100, `visual response did not improve: ${beforeMs} -> ${afterMs}`);
assert.ok(before.every((sample) => sample.reloads === 1));
assert.ok(after.every((sample) => sample.reloads === 0));
console.log(JSON.stringify({ synthetic: true, baselineVisualMs: Math.round(beforeMs),
  candidateVisualMs: Math.round(afterMs), baselineReloads: 1, candidateReloads: 0 }));
