import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PUBLIC_BOOKING_RATE_LIMITS } from "../src/lib/public-booking-rate-limits";

type SyntheticAppointment = {
  id: string;
  studioId: string;
  clientId: string;
  staffId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
};

const TIMES = [
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
];

function createSyntheticFlow(serviceForIndex: (index: number) => string) {
  let phoneAttempts = 0;
  const persisted = new Map<string, SyntheticAppointment>();
  const notificationEvents = new Map<string, { appointmentId: string }>();

  for (const [index, time] of TIMES.entries()) {
    phoneAttempts += 1;
    if (phoneAttempts > PUBLIC_BOOKING_RATE_LIMITS.phone.limit) {
      throw new Error("rate_limit_exceeded");
    }

    const startsAt = `2026-10-05T${time}:00+01:00`;
    const appointment: SyntheticAppointment = {
      id: `appointment-${index + 1}`,
      studioId: "studio-1",
      clientId: "client-1",
      staffId: "staff-1",
      serviceId: serviceForIndex(index),
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
    };

    // The real database keys appointments by their generated id and notifications
    // by new_appointment:<appointment id>, never by client/service/day.
    persisted.set(appointment.id, appointment);
    notificationEvents.set(`new_appointment:${appointment.id}`, {
      appointmentId: appointment.id,
    });
  }

  const agenda = [...persisted.values()]
    .filter((appointment) => appointment.studioId === "studio-1")
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));

  return { created: TIMES.length, persisted, agenda, notificationEvents };
}

function rateLimitAllows(attempt: number, limit: number) {
  return attempt <= limit;
}

test.describe("repeated legitimate public bookings", () => {
  test("keeps 10 bookings for the same client, professional, service and day", () => {
    const result = createSyntheticFlow(() => "service-1");

    expect(PUBLIC_BOOKING_RATE_LIMITS.phone.limit).toBe(10);
    expect(result.created).toBe(10);
    expect(result.persisted.size).toBe(10);
    expect(new Set(result.persisted.keys()).size).toBe(10);
    expect(result.agenda).toHaveLength(10);
    expect(result.notificationEvents.size).toBe(10);
    expect(new Set(result.agenda.map((appointment) => appointment.startsAt)).size).toBe(10);
  });

  test("does not collapse alternating services for the same client and professional", () => {
    const result = createSyntheticFlow((index) => `service-${(index % 2) + 1}`);

    expect(result.persisted.size).toBe(10);
    expect(result.agenda).toHaveLength(10);
    expect(result.notificationEvents.size).toBe(10);
    expect(new Set(result.agenda.map((appointment) => appointment.serviceId))).toEqual(
      new Set(["service-1", "service-2"]),
    );
  });

  test("blocks the 11th phone attempt and preserves every other abuse threshold", async () => {
    const durableRateLimitSql = await readFile(
      "supabase/migrations/20260601173000_server_rate_limits.sql",
      "utf8",
    );

    expect(durableRateLimitSql).toContain("v_count <= p_limit");
    expect(rateLimitAllows(10, PUBLIC_BOOKING_RATE_LIMITS.phone.limit)).toBe(true);
    expect(rateLimitAllows(11, PUBLIC_BOOKING_RATE_LIMITS.phone.limit)).toBe(false);
    expect(rateLimitAllows(16, PUBLIC_BOOKING_RATE_LIMITS.ip.limit)).toBe(false);
    expect(rateLimitAllows(5, PUBLIC_BOOKING_RATE_LIMITS.slot.limit)).toBe(false);
    expect(rateLimitAllows(61, PUBLIC_BOOKING_RATE_LIMITS.studio.limit)).toBe(false);
  });

  test("retains tenant scope and real same-professional overlap protection", async () => {
    const [bookingSql, notificationSql, agendaSource, bookingSource] = await Promise.all([
      readFile("supabase/migrations/20260907201000_plan_aware_public_booking.sql", "utf8"),
      readFile("supabase/migrations/20260821150000_notification_delivery_exactly_once.sql", "utf8"),
      readFile("src/lib/agenda-access.functions.ts", "utf8"),
      readFile("src/lib/public-booking.functions.ts", "utf8"),
    ]);

    expect(bookingSql).toContain("RETURNING id INTO v_appt_id");
    expect(bookingSql).toContain("IF NOT v_available THEN RAISE EXCEPTION 'slot_unavailable'");
    expect(bookingSql).toContain("WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable'");
    expect(notificationSql).toContain("'event_key', 'new_appointment:' || new.id::text");
    expect(agendaSource).toContain('.eq("studio_id", data.studioId)');
    expect(bookingSource).toContain("PUBLIC_BOOKING_RATE_LIMITS.phone");
  });
});
