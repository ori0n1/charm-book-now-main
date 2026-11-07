import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const source = readFileSync(new URL("../src/lib/smart-whatsapp-reminder.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", "require", compiled)(exports, require);
const { getSmartReminderSchedule, isSmartReminderDue, smartReminderTemplateId,
  whatsappReminderIdempotencyKey } = exports;

const start = "2026-11-08T12:00:00.000Z";
const before = (minutes) => new Date(Date.parse(start) - minutes * 60_000).toISOString();

test("confirmation lead selects exactly one future reminder window", () => {
  assert.equal(getSmartReminderSchedule(before(1500), start)?.windowMinutes, 1440);
  assert.equal(getSmartReminderSchedule(before(1440), start)?.windowMinutes, 120);
  assert.equal(getSmartReminderSchedule(before(600), start)?.windowMinutes, 120);
  assert.equal(getSmartReminderSchedule(before(120), start)?.windowMinutes, 30);
  assert.equal(getSmartReminderSchedule(before(60), start)?.windowMinutes, 30);
  assert.equal(getSmartReminderSchedule(before(30), start), null);
  assert.equal(getSmartReminderSchedule(before(20), start), null);
});

test("does not dispatch at confirmation, after cancellation, or outside the due window", () => {
  const confirmedAt = before(600);
  assert.equal(isSmartReminderDue({ status: "confirmed", confirmedAt, startsAt: start, now: confirmedAt }), false);
  assert.equal(isSmartReminderDue({ status: "confirmed", confirmedAt, startsAt: start, now: before(120) }), true);
  assert.equal(isSmartReminderDue({ status: "cancelled", confirmedAt, startsAt: start, now: before(120) }), false);
  assert.equal(isSmartReminderDue({ status: "confirmed", confirmedAt, startsAt: start, now: before(117) }), false);
});

test("absolute instants preserve studio times across daylight saving changes", () => {
  const startsAt = "2026-03-29T02:30:00.000Z";
  const confirmedAt = "2026-03-27T02:30:00.000Z";
  assert.equal(getSmartReminderSchedule(confirmedAt, startsAt)?.dueAt, Date.parse("2026-03-28T02:30:00.000Z"));
});

test("idempotency key stays identical across reminder windows and changes on reschedule", () => {
  const key = whatsappReminderIdempotencyKey("appointment-1", start);
  assert.equal(key, `arara-reminder-2h-appointment-1-${Date.parse(start)}`);
  assert.equal(whatsappReminderIdempotencyKey("appointment-1", start), key);
  assert.notEqual(whatsappReminderIdempotencyKey("appointment-1", "2026-11-08T13:00:00.000Z"), key);
});

test("payment confirmation and reschedule use their effective confirmation instants", () => {
  const createdWhilePending = before(3000);
  const paidAndConfirmed = before(90);
  assert.ok(Date.parse(createdWhilePending) < Date.parse(paidAndConfirmed));
  assert.equal(getSmartReminderSchedule(paidAndConfirmed, start)?.windowMinutes, 30);
  assert.equal(isSmartReminderDue({ status: "pending_payment", confirmedAt: paidAndConfirmed,
    startsAt: start, now: before(30) }), false);
  assert.equal(isSmartReminderDue({ status: "confirmed", confirmedAt: paidAndConfirmed,
    startsAt: start, now: before(30) }), true);

  const rescheduledStart = "2026-11-10T12:00:00.000Z";
  const rescheduledAt = "2026-11-08T13:00:00.000Z";
  assert.equal(getSmartReminderSchedule(rescheduledAt, rescheduledStart)?.windowMinutes, 1440);
  assert.notEqual(whatsappReminderIdempotencyKey("appointment-1", start),
    whatsappReminderIdempotencyKey("appointment-1", rescheduledStart));
  assert.equal(getSmartReminderSchedule(before(20), start), null);
});

test("legacy transition retains the original provider template selection", () => {
  const approvedId = "ceb5d4be-985c-48fd-896c-7afff61e9d1c";
  assert.equal(smartReminderTemplateId("reminder_2h", false, approvedId), approvedId);
  assert.equal(smartReminderTemplateId("reminder_2h", true, approvedId), "");
  assert.equal(smartReminderTemplateId("confirmation", false, approvedId), "");
  assert.equal(smartReminderTemplateId("reschedule", false, approvedId), "");
});
