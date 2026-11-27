import assert from "node:assert/strict";
import test from "node:test";
import { isManualReminderOpen, isManualReminderPending } from "../src/lib/manual-appointment-reminder.ts";

const start = "2026-11-27T10:00:00Z";
const at = (time) => new Date(`2026-11-27T${time}Z`);

test("a pendência só aparece nas duas horas antes do atendimento", () => {
  assert.equal(isManualReminderPending(start, at("07:59:59")), false);
  assert.equal(isManualReminderPending(start, at("08:00:00")), true);
  assert.equal(isManualReminderPending(start, at("09:59:59")), true);
  assert.equal(isManualReminderPending(start, at("10:00:00")), false);
});

test("uma confirmação anterior não substitui o lembrete desta marcação", () => {
  assert.equal(isManualReminderOpen(start, "2026-11-27T07:30:00Z"), false);
  assert.equal(isManualReminderPending(start, at("09:00:00"), "2026-11-27T07:30:00Z"), true);
  assert.equal(isManualReminderOpen(start, "2026-11-27T09:00:00Z"), true);
  assert.equal(isManualReminderPending(start, at("09:00:01"), "2026-11-27T09:00:00Z"), false);
});
