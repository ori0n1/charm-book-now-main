import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync("src/routes/_authenticated/admin.agenda.tsx", "utf8");
const start = source.indexOf("  function commitScheduleResult(");
const end = source.indexOf("\n  return (", start);
assert.ok(start >= 0 && end > start);
const functionSource = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

const appointmentId = "appointment-a";
const oldStart = "2030-10-30T10:00:00.000Z";
const oldEnd = "2030-10-30T11:00:00.000Z";
const newStart = "2030-10-30T11:00:00.000Z";
const newEnd = "2030-10-30T12:00:00.000Z";
const makeAppointment = () => ({ id: appointmentId, status: "confirmed", starts_at: oldStart,
  ends_at: oldEnd, staff: { id: "staff-a" }, appointment_services: [{ id: "line-a",
    services: { id: "service-a" }, staff: { id: "staff-a" }, starts_at: oldStart, ends_at: oldEnd }] });

async function runCase(outcome) {
  let appointments = [makeAppointment()];
  let catalogCalls = 0;
  let reloadCalls = 0;
  let moveCalls = 0;
  let releaseMove;
  let markMoveCalled;
  const moveCalled = new Promise((done) => { markMoveCalled = done; });
  const moveResult = new Promise((resolve, reject) => { releaseMove = { resolve, reject }; });
  const context = {
    studio: { id: "studio-a", role: "studio_owner" }, appts: appointments,
    agendaStaff: [{ id: "staff-a", name: "QA profissional" }],
    selectedDate: new Date("2030-10-30T00:00:00Z"),
    paidByAppointment: new Map(),
    pendingDropMovesRef: { current: new Set() },
    agendaLoadSequenceRef: { current: 0 },
    setAppts: (update) => { appointments = update(appointments); },
    setLoading: () => {},
    toDateInputValue: () => "2030-10-30",
    loadDropCatalog: async () => { catalogCalls++; return { links: [], staff: [] }; },
    resolveDropDateTime: async () => ({ startsAt: newStart }),
    previewDropSchedule: async () => ({ staffAvailable: true, paymentHolds: [],
      hardBlocked: false, withinAvailability: true, hasConflict: false }),
    moveDroppedAppointment: async () => { moveCalls++; markMoveCalled(); return moveResult; },
    loadData: async () => { reloadCalls++; },
    toast: { error: () => {}, info: () => {}, success: () => {} },
    scheduleChangeMessage: (error) => error.message,
    isManualAppointmentServiceAllowed: () => true,
    setDropRescheduleDraft: () => {}, setRescheduleServiceLineId: () => {},
    setRescheduleApptId: () => {}, setDropEditDraft: () => {}, setEditApptId: () => {},
    Date, Math, String, Promise, Set,
  };
  vm.runInNewContext(`${functionSource}\nthis.drop = prepareDraggedAppointment;`, context);
  const pending = context.drop({ id: appointmentId, startsAt: oldStart, endsAt: oldEnd },
    "staff-a", 660);
  await moveCalled;
  assert.equal(appointments[0].starts_at, newStart, "visual move precedes RPC response");
  assert.equal(appointments[0].appointment_services[0].ends_at, newEnd);
  if (outcome === "success") releaseMove.resolve({ changed: true, appointmentId,
    startsAt: newStart, endsAt: newEnd, durationMin: 60, isManualFit: false,
    services: [{ id: "line-a", staffId: "staff-a", startsAt: newStart,
      endsAt: newEnd, durationMin: 60 }] });
  else releaseMove.reject(new Error("synthetic_database_failure"));
  await pending;
  assert.equal(appointments[0].starts_at, outcome === "success" ? newStart : oldStart);
  assert.equal(appointments[0].appointment_services[0].ends_at,
    outcome === "success" ? newEnd : oldEnd);
  assert.equal(catalogCalls, 0, "same-professional move skips catalog");
  assert.equal(reloadCalls, 0, "drop does not launch a full agenda reload");
  assert.equal(moveCalls, 1);
  assert.equal(context.pendingDropMovesRef.current.size, 0);
}

await runCase("success");
await runCase("failure");
console.log("optimistic move, rollback and redundant-call checks passed");
