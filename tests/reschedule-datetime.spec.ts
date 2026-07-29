import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { normalizeAppointmentStart } from "../src/lib/appointment-datetime";

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

  test("accepts same-day and future 15-minute slots in every supported hour", () => {
    for (const value of [
      "2026-07-29T00:00:00Z",
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
    const [serverSource, migrationSource] = await Promise.all([
      readFile("src/lib/client-appointment.functions.ts", "utf8"),
      readFile(
        "supabase/migrations/20260702143000_booking_time_cross_sell_consistency.sql",
        "utf8",
      ),
    ]);

    expect(serverSource).toContain("p_slot_step_min: 15");
    expect(serverSource).toContain("p_starts_at: data.startsAt");
    expect(migrationSource).toContain(
      "FROM public.get_available_slots(v_appt.slug, p_staff_id",
    );
    expect(migrationSource).toContain(
      "v_new_end := p_starts_at + (v_duration || ' minutes')::interval",
    );
  });

  test("does not expose validator or API details to the client", async () => {
    const routeSource = await readFile("src/routes/marcacao.$token.tsx", "utf8");

    expect(routeSource).toContain("if (import.meta.env.DEV)");
    expect(routeSource).toContain("selectedDate: rescheduleDate");
    expect(routeSource).toContain("selectedTime: slot.label");
    expect(routeSource).not.toContain("payload: { token");
    expect(routeSource).toContain(
      'toast.error("Não foi possível remarcar o agendamento. Tente novamente em alguns instantes.")',
    );
    expect(routeSource).not.toContain(
      'toast.error(error instanceof Error ? error.message : "Não foi possível remarcar.")',
    );
  });
});
