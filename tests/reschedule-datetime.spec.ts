import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { normalizeAppointmentStart } from "../src/lib/appointment-datetime";
import { getRescheduleUserMessage } from "../src/lib/appointment-reschedule-errors";

test.describe("reschedule startsAt contract", () => {
  test("accepts PostgREST timestamps with offsets and emits canonical UTC", () => {
    expect(normalizeAppointmentStart("2026-07-29T09:15:00+00:00")).toBe(
      "2026-07-29T09:15:00.000Z",
    );
    expect(normalizeAppointmentStart("2026-07-29T09:15:00+01:00")).toBe(
      "2026-07-29T08:15:00.000Z",
    );
    expect(normalizeAppointmentStart("2026-12-15T09:15:00-05:00")).toBe(
      "2026-12-15T14:15:00.000Z",
    );
  });

  test("accepts same-day, arbitrary-minute and future slots", () => {
    for (const value of [
      "2026-07-29T00:00:00Z",
      "2026-07-29T08:11:00Z",
      "2026-07-29T09:15:00Z",
      "2026-07-29T12:30:00Z",
      "2027-01-01T23:45:00Z",
    ]) {
      expect(normalizeAppointmentStart(value)).toBe(new Date(value).toISOString());
    }
  });

  test("rejects missing, local, empty, and invalid datetimes", () => {
    for (const value of [
      null,
      undefined,
      "",
      "Invalid Date",
      "2026-07-29T09:15",
      "29/07/2026 09:15",
    ]) {
      expect(() => normalizeAppointmentStart(value)).toThrow();
    }
  });

  test("keeps duration and availability rules on the database boundary", async () => {
    const [serverSource, migrationSource, availabilitySource] = await Promise.all([
      readFile("src/lib/client-appointment.functions.ts", "utf8"),
      readFile(
        "supabase/migrations/20260808101500_fix_reschedule_false_slot_conflicts.sql",
        "utf8",
      ),
      readFile(
        "supabase/migrations/20260628103000_booking_availability_consistency.sql",
        "utf8",
      ),
    ]);

    expect(serverSource).toContain("p_slot_step_min: 15");
    expect(serverSource).toContain('rpc("get_public_reschedule_slots"');
    expect(serverSource).toContain("p_public_token: data.token");
    expect(serverSource).not.toContain('rpc("get_available_slots"');
    expect(serverSource).toContain("p_starts_at: data.startsAt");
    expect(migrationSource).not.toContain("FROM public.get_available_slots(");
    expect(migrationSource).toContain(
      "v_new_end := p_starts_at + make_interval(mins => v_duration)",
    );
    expect(migrationSource).toContain("WHERE aps.appointment_id = v_appt.id");
    expect(migrationSource).toContain("NULL,\n      v_appt.id");
    expect(migrationSource.match(/NULL,\n {6}v_appt\.id/g)).toHaveLength(3);
    expect(migrationSource).toContain("NULLIF(v_appt.total_duration_min, 0)");
    expect(migrationSource).toContain("CREATE OR REPLACE FUNCTION public.get_public_reschedule_slots");
    expect(migrationSource).toContain("WHEN exclusion_violation");
    expect(availabilitySource).toContain("p_ignore_appointment_id uuid DEFAULT NULL");
    expect(availabilitySource).toContain("a.id <> p_ignore_appointment_id");
    expect(availabilitySource).toContain("a.status NOT IN ('cancelled','no_show')");
    expect(availabilitySource).toContain("tstzrange(a.starts_at, a.ends_at, '[)')");
  });

  test("uses real half-open intervals without false conflicts at exact boundaries", () => {
    const overlaps = (
      newStart: string,
      newEnd: string,
      existingStart: string,
      existingEnd: string,
    ) =>
      new Date(newStart).getTime() < new Date(existingEnd).getTime() &&
      new Date(newEnd).getTime() > new Date(existingStart).getTime();

    expect(
      overlaps(
        "2026-08-08T13:15:00Z",
        "2026-08-08T14:00:00Z",
        "2026-08-08T12:30:00Z",
        "2026-08-08T13:15:00Z",
      ),
    ).toBe(false);
    expect(
      overlaps(
        "2026-08-08T13:15:00Z",
        "2026-08-08T14:00:00Z",
        "2026-08-08T13:59:00Z",
        "2026-08-08T14:30:00Z",
      ),
    ).toBe(true);
    expect(
      overlaps(
        "2026-08-08T08:11:00Z",
        "2026-08-08T08:56:00Z",
        "2026-08-08T09:00:00Z",
        "2026-08-08T09:30:00Z",
      ),
    ).toBe(false);
  });

  test("maps technical failures to safe and useful client messages", () => {
    expect(getRescheduleUserMessage(new Error("slot_unavailable"))).toBe(
      "Este horário já não está disponível. Escolha outro horário.",
    );
    expect(
      getRescheduleUserMessage(new Error("appointment_not_reschedulable")),
    ).toBe("Esta marcação já não pode ser remarcada.");
    expect(getRescheduleUserMessage(new Error("invalid datetime"))).toBe(
      "A data ou o horário selecionado não é válido. Escolha novamente.",
    );
    expect(getRescheduleUserMessage(new Error('column "secret" failed'))).toBe(
      "Não foi possível remarcar. Tente novamente mais tarde.",
    );
  });

  test("logs technical details without exposing them to the client", async () => {
    const routeSource = await readFile("src/routes/marcacao.$token.tsx", "utf8");
    const serverSource = await readFile(
      "src/lib/client-appointment.functions.ts",
      "utf8",
    );

    expect(routeSource).toContain("if (import.meta.env.DEV)");
    expect(routeSource).toContain("selectedDate: rescheduleDate");
    expect(routeSource).toContain("selectedTime: slot.label");
    expect(routeSource).not.toContain("payload: { token");
    expect(routeSource).toContain("getRescheduleUserMessage(");
    expect(serverSource).toContain(
      '"[client-reschedule] database mutation failed"',
    );
    expect(serverSource).toContain("code: error.code");
    expect(serverSource).toContain("details: error.details");
    expect(routeSource).not.toContain(
      'toast.error(error instanceof Error ? error.message : "Não foi possível remarcar.")',
    );
  });

  test("studio reschedule uses the atomic server flow and studio wall-clock time", async () => {
    const [agendaSource, serverSource, migrationSource] = await Promise.all([
      readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8"),
      readFile("src/lib/studio-appointment.functions.ts", "utf8"),
      readFile(
        "supabase/migrations/20260808101500_fix_reschedule_false_slot_conflicts.sql",
        "utf8",
      ),
    ]);

    expect(agendaSource).toContain("rescheduleStudioAppointment");
    expect(agendaSource).toContain("date,");
    expect(agendaSource).toContain("time,");
    expect(serverSource).toContain("requireSupabaseAuth");
    expect(serverSource).toContain("assertStudioAccess");
    expect(serverSource).toContain('rpc("reschedule_studio_appointment"');
    expect(serverSource).toContain("sendAppointmentLifecycleMessage");
    expect(serverSource).toContain("dispatchPendingStudioPushNotifications");
    expect(migrationSource).toContain(
      "v_starts_at := (p_local_date::timestamp + p_local_time) AT TIME ZONE v_tz",
    );
    expect(migrationSource).toContain(
      "REVOKE ALL ON FUNCTION public.reschedule_studio_appointment",
    );
  });

  test("keeps back-office walk-ins movable without weakening public availability", async () => {
    const migrationSource = await readFile(
      "supabase/migrations/20260808113000_preserve_studio_walkin_reschedule_override.sql",
      "utf8",
    );

    expect(migrationSource).toContain("v_is_managerial_override := NOT EXISTS");
    expect(migrationSource).toContain("v_original_local_start");
    expect(migrationSource).toContain("is_staff_managerial_slot_bookable");
    expect(migrationSource).toContain("v_appt.id");
    expect(migrationSource).toContain("appointment.status NOT IN ('cancelled', 'no_show')");
    expect(migrationSource).toContain("public.staff_time_off");
    expect(migrationSource).toContain("public.booking_payment_requests");
    expect(migrationSource).not.toContain("reschedule_public_appointment");
    expect(migrationSource).toContain(
      "REVOKE ALL ON FUNCTION public.is_staff_managerial_slot_bookable",
    );
  });
});
