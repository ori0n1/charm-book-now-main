import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  appointmentLifecycleEventKey,
  getAppointmentLifecycleStage,
  isAppointmentReminderDispatchable,
  lifecycleStageLabel,
  shouldSendAppointmentReminder,
} from "../src/lib/appointment-lifecycle";
import {
  buildAppointmentPaymentFacts,
  computeAppointmentFinancialSplit,
  computeAppointmentLedger,
} from "../src/lib/financial-ledger";
import {
  attendancePendingSummaryLabel,
  buildAttendanceReviewState,
  isAttendanceClosingReview,
} from "../src/lib/attendance-confirmation-ui";

const startsAt = "2026-09-01T18:00:00.000Z";

test("normal appointment enters the two-hour reminder window", () => {
  expect(
    shouldSendAppointmentReminder({
      status: "confirmed",
      startsAt,
      now: "2026-09-01T16:00:00.000Z",
      reminderMinutes: 120,
    }),
  ).toBe(true);
});

test("appointment created less than two hours before is immediately eligible for one reminder", () => {
  expect(
    shouldSendAppointmentReminder({
      status: "confirmed",
      startsAt,
      now: "2026-09-01T17:45:00.000Z",
      reminderMinutes: 120,
    }),
  ).toBe(true);
  expect(appointmentLifecycleEventKey("a1", startsAt, "reminder")).toBe(
    appointmentLifecycleEventKey("a1", startsAt, "reminder"),
  );
});

test("client arriving late remains awaiting service inside the grace period", () => {
  expect(
    getAppointmentLifecycleStage({
      status: "confirmed",
      startsAt,
      now: "2026-09-01T18:20:00.000Z",
      graceMinutes: 30,
    }),
  ).toBe("awaiting_service");
});

test("forgotten appointment waits for professional confirmation and never becomes no-show automatically", () => {
  const stage = getAppointmentLifecycleStage({
    status: "confirmed",
    startsAt,
    now: "2026-09-01T18:31:00.000Z",
    graceMinutes: 30,
  });
  expect(stage).toBe("awaiting_confirmation");
  expect(lifecycleStageLabel(stage)).toBe("Aguardando confirmação");
});

test("explicit attendance outcomes and cancellation are terminal", () => {
  expect(getAppointmentLifecycleStage({ status: "completed", startsAt })).toBe("completed");
  expect(getAppointmentLifecycleStage({ status: "no_show", startsAt })).toBe("no_show");
  expect(getAppointmentLifecycleStage({ status: "cancelled", startsAt })).toBe("cancelled");
});

test("rescheduling after a reminder creates a new event identity", () => {
  const before = appointmentLifecycleEventKey("a1", startsAt, "reminder");
  const after = appointmentLifecycleEventKey(
    "a1",
    "2026-09-01T19:00:00.000Z",
    "reminder",
  );
  expect(after).not.toBe(before);
});

test("cancellation after reminder is no longer reminder-eligible", () => {
  expect(
    shouldSendAppointmentReminder({
      status: "cancelled",
      startsAt,
      now: "2026-09-01T17:00:00.000Z",
    }),
  ).toBe(false);
});

test("queued reminder is rejected after start, cancellation or reschedule", () => {
  const original = "2026-09-07T08:15:00.000Z";
  expect(isAppointmentReminderDispatchable({
    status: "confirmed",
    startsAt: original,
    queuedStartsAt: original,
    now: "2026-09-07T08:14:59.000Z",
  })).toBe(true);
  expect(isAppointmentReminderDispatchable({
    status: "confirmed",
    startsAt: original,
    queuedStartsAt: original,
    now: original,
  })).toBe(false);
  expect(isAppointmentReminderDispatchable({
    status: "cancelled",
    startsAt: original,
    queuedStartsAt: original,
    now: "2026-09-07T08:00:00.000Z",
  })).toBe(false);
  expect(isAppointmentReminderDispatchable({
    status: "confirmed",
    startsAt: "2026-09-07T09:15:00.000Z",
    queuedStartsAt: original,
    now: "2026-09-07T08:00:00.000Z",
  })).toBe(false);
});

test("database and both push audiences enforce reminder freshness at delivery time", () => {
  const migration = readFileSync(
    "supabase/migrations/20260907165000_notification_reminder_freshness.sql",
    "utf8",
  );
  const studioDispatcher = readFileSync("src/lib/notification-dispatcher.server.ts", "utf8");
  const clientDispatcher = readFileSync("src/lib/public-client.functions.ts", "utf8");
  expect(migration).toContain("v_current_starts_at <= now()");
  expect(migration).toContain("appointment_schedule_changed");
  expect(migration).toContain("d.status IN ('pending', 'retry', 'delivering')");
  expect(studioDispatcher).toContain("isAppointmentReminderDispatchable");
  expect(clientDispatcher).toContain("clientAppointmentPushInvalidReason");
  expect(clientDispatcher).toContain('.in("status", ["sent", "skipped"])');
});

test("timezone offsets are compared by absolute instant", () => {
  expect(
    getAppointmentLifecycleStage({
      status: "confirmed",
      startsAt: "2026-09-01T18:00:00+01:00",
      now: "2026-09-01T17:31:00Z",
      graceMinutes: 30,
    }),
  ).toBe("awaiting_confirmation");
});

test("simultaneous professionals and appointments keep independent event keys", () => {
  const keys = ["professional-a", "professional-b", "professional-c"].map((id) =>
    appointmentLifecycleEventKey(id, startsAt, "attendance_confirmation"),
  );
  expect(new Set(keys).size).toBe(3);
});

test("online deposit remains received on no-show but produces no realized service revenue", () => {
  const facts = buildAppointmentPaymentFacts(
    [{ id: "p1", appointment_id: "a1", amount_cents: 3000, status: "succeeded" }],
    [],
    [],
  );
  const ledger = computeAppointmentLedger("a1", 100, "no_show", facts.get("a1"));
  expect(ledger.receivedCents).toBe(3000);
  expect(ledger.scheduledCents).toBe(0);
  expect(ledger.realizedCents).toBe(0);
  expect(ledger.lostRevenueCents).toBe(7000);
});

test("full advance payment remains received on no-show without commission or realized revenue", () => {
  const facts = buildAppointmentPaymentFacts(
    [{ id: "p1", appointment_id: "a1", amount_cents: 10000, status: "succeeded" }],
    [],
    [],
  );
  const split = computeAppointmentFinancialSplit(
    "a1",
    { total_price: 100, status: "no_show", studio_commission_percent_snapshot: 30 },
    30,
    facts.get("a1"),
  );
  expect(split.received).toBe(100);
  expect(split.realized).toBe(0);
  expect(split.commissionBase).toBe(0);
  expect(split.studio + split.professional).toBe(0);
});

test("cancelled appointment keeps unrefunded money visible without service revenue", () => {
  const facts = buildAppointmentPaymentFacts(
    [{ id: "p-cancel", appointment_id: "cancelled-a", amount_cents: 2500, status: "succeeded" }],
    [],
    [],
  );
  const ledger = computeAppointmentLedger(
    "cancelled-a",
    100,
    "cancelled",
    facts.get("cancelled-a"),
  );
  expect(ledger.receivedCents).toBe(2500);
  expect(ledger.scheduledCents).toBe(0);
  expect(ledger.realizedCents).toBe(0);
  expect(ledger.pendingCents).toBe(0);
  expect(ledger.lostRevenueCents).toBe(0);
});

test("completed in-person payment is received and realized exactly once", () => {
  const facts = buildAppointmentPaymentFacts(
    [],
    [{ id: "cash-1", appointment_id: "a1", amount: 100, movement_type: "service_payment" }],
    [],
  );
  const split = computeAppointmentFinancialSplit(
    "a1",
    { total_price: 100, status: "completed", studio_commission_percent_snapshot: 30 },
    30,
    facts.get("a1"),
  );
  expect(split.receivedOnsite).toBe(100);
  expect(split.realized).toBe(100);
  expect(split.studio).toBe(30);
  expect(split.professional).toBe(70);
});

test("confirmed unpaid appointment is scheduled but not received or realized", () => {
  const ledger = computeAppointmentLedger("a1", 100, "confirmed");
  expect(ledger.scheduledCents).toBe(10000);
  expect(ledger.pendingCents).toBe(10000);
  expect(ledger.receivedCents).toBe(0);
  expect(ledger.realizedCents).toBe(0);
});

test("database lifecycle is prospective, idempotent, timezone-aware and uses configured closing time", () => {
  const migration = readFileSync(
    "supabase/migrations/20260828120000_intelligent_appointment_lifecycle.sql",
    "utf8",
  );
  expect(migration).toContain("starts_at > now()");
  expect(migration).toContain("ON CONFLICT DO NOTHING");
  expect(migration).toContain("AT TIME ZONE");
  expect(migration).toContain("max(availability.end_time)");
  expect(migration).toContain("appointment.status = 'confirmed'");
  expect(migration).not.toContain("SET status = 'no_show'");
});

test("attendance mutation is service-only, scoped and audited", () => {
  const migration = readFileSync(
    "supabase/migrations/20260828120000_intelligent_appointment_lifecycle.sql",
    "utf8",
  );
  const server = readFileSync("src/lib/agenda-access.functions.ts", "utf8");
  expect(migration).toContain("auth.role() <> 'service_role'");
  expect(migration).toContain("id = p_appointment_id AND studio_id = p_studio_id");
  expect(migration).toContain("attendance_resolved_by = p_actor_id");
  expect(server).toContain("resolveProtectedAppointmentAttendance");
  expect(server).toContain("appointment.staff_id !== access.staffId");
});

test("end-of-day summary is one event per studio and local date", () => {
  const migration = readFileSync(
    "supabase/migrations/20260828120000_intelligent_appointment_lifecycle.sql",
    "utf8",
  );
  const outboxMigration = readFileSync(
    "supabase/migrations/20260729130000_reliable_studio_notifications.sql",
    "utf8",
  );
  expect(migration).toContain("'attendance_summary:' || v_summary.studio_id::text || ':' || v_summary.local_date::text");
  expect(outboxMigration).toContain("idx_studio_notifications_event_key");
});

test("attendance review stays hidden with no pending appointments", () => {
  const state = buildAttendanceReviewState([], null);
  expect(state.visibleItems).toEqual([]);
  expect(state.totalPending).toBe(0);
});

test("one pending appointment opens a focused quick confirmation", () => {
  const item = { id: "one", startsAt: "2026-09-01T10:15:00Z" };
  const state = buildAttendanceReviewState([item], item.id);
  expect(state.mode).toBe("single");
  expect(state.visibleItems).toEqual([item]);
  expect(attendancePendingSummaryLabel(1)).toBe("1 atendimento para confirmar");
});

test("three pending appointments are grouped and ordered chronologically", () => {
  const state = buildAttendanceReviewState(
    [
      { id: "three", startsAt: "2026-09-01T12:15:00Z" },
      { id: "one", startsAt: "2026-09-01T10:15:00Z" },
      { id: "two", startsAt: "2026-09-01T11:15:00Z" },
    ],
    null,
  );
  expect(state.mode).toBe("group");
  expect(state.visibleItems.map((item) => item.id)).toEqual(["one", "two", "three"]);
  expect(state.summaryLabel).toBe("3 atendimentos para confirmar");
});

test("ten or more pending appointments remain one grouped review", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `appointment-${index}`,
    startsAt: new Date(Date.UTC(2026, 8, 1, 8, index)).toISOString(),
  }));
  const state = buildAttendanceReviewState(items, null);
  expect(state.visibleItems).toHaveLength(12);
  expect(state.summaryLabel).toBe("12 atendimentos para confirmar");
});

test("resolved attendance disappears from the next grouped projection", () => {
  const items = [
    { id: "resolved", startsAt: "2026-09-01T10:15:00Z" },
    { id: "pending", startsAt: "2026-09-01T11:15:00Z" },
  ];
  expect(buildAttendanceReviewState(items, null).visibleItems).toHaveLength(2);
  expect(buildAttendanceReviewState(items.filter((item) => item.id !== "resolved"), null).visibleItems)
    .toHaveLength(1);
});

test("closing review starts only after the latest availability end", () => {
  const selectedDate = new Date(2026, 8, 1);
  const availability = [{ endMinutes: 17 * 60 }, { endMinutes: 19 * 60 }];
  expect(isAttendanceClosingReview(new Date(2026, 8, 1, 18, 59), selectedDate, availability)).toBe(false);
  expect(isAttendanceClosingReview(new Date(2026, 8, 1, 19, 0), selectedDate, availability)).toBe(true);
});

test("attendance confirmation notifications are grouped without changing financial data", () => {
  const migration = readFileSync(
    "supabase/migrations/20260828210000_group_attendance_confirmation_notifications.sql",
    "utf8",
  );
  expect(migration).toContain("attendance_confirmation:' || NEW.studio_id::text || ':' || v_local_date::text");
  expect(migration).toContain("BEFORE INSERT ON public.studio_notifications");
  expect(migration).not.toMatch(/UPDATE\s+public\.(appointments|payment_intents|cash_register_movements)/i);
});

test("Agenda uses one compact trigger and a dedicated grouped confirmation sheet", () => {
  const agenda = readFileSync("src/routes/_authenticated/admin.agenda.tsx", "utf8");
  const sheet = readFileSync("src/components/agenda/attendance-pending-sheet.tsx", "utf8");
  expect(agenda).toContain('data-testid="attendance-pending-summary"');
  expect(agenda).toContain("<AttendancePendingSheet");
  expect(sheet).toContain('data-testid="attendance-pending-item"');
  expect(sheet).toContain("max-h-[min(86dvh,42rem)]");
});
