import { test, expect } from "@playwright/test";
import { sortAppointmentsChronologically } from "../src/lib/appointment-ordering";

const unorderedAppointments = [
  { id: "created-first", created_at: "2026-07-07T20:00:00.000Z", starts_at: "2026-07-09T14:00:00.000Z" },
  { id: "created-second", created_at: "2026-07-07T21:00:00.000Z", starts_at: "2026-07-09T09:00:00.000Z" },
  { id: "created-third", created_at: "2026-07-07T22:00:00.000Z", starts_at: "2026-07-09T12:00:00.000Z" },
];

test("orders future appointments by appointment time, not creation order", () => {
  const ordered = sortAppointmentsChronologically(unorderedAppointments, "future");

  expect(ordered.map((appointment) => appointment.starts_at)).toEqual([
    "2026-07-09T09:00:00.000Z",
    "2026-07-09T12:00:00.000Z",
    "2026-07-09T14:00:00.000Z",
  ]);
});

test("orders history appointments with the latest appointment first", () => {
  const ordered = sortAppointmentsChronologically(unorderedAppointments, "history");

  expect(ordered.map((appointment) => appointment.starts_at)).toEqual([
    "2026-07-09T14:00:00.000Z",
    "2026-07-09T12:00:00.000Z",
    "2026-07-09T09:00:00.000Z",
  ]);
});

test("uses the same chronological source of truth for every appointment list", () => {
  const screens = {
    agenda: sortAppointmentsChronologically(unorderedAppointments, "future"),
    home: sortAppointmentsChronologically(unorderedAppointments, "future"),
    nextAppointment: sortAppointmentsChronologically(unorderedAppointments, "future").slice(0, 1),
    today: sortAppointmentsChronologically(unorderedAppointments, "future"),
    clientUpcoming: sortAppointmentsChronologically(
      unorderedAppointments.map((appointment) => ({
        id: appointment.id,
        created_at: appointment.created_at,
        startsAt: appointment.starts_at,
      })),
      "future",
    ),
    clientHistory: sortAppointmentsChronologically(
      unorderedAppointments.map((appointment) => ({
        id: appointment.id,
        created_at: appointment.created_at,
        startsAt: appointment.starts_at,
      })),
      "history",
    ),
  };

  expect(screens.agenda.map((appointment) => appointment.starts_at)).toEqual([
    "2026-07-09T09:00:00.000Z",
    "2026-07-09T12:00:00.000Z",
    "2026-07-09T14:00:00.000Z",
  ]);
  expect(screens.home.map((appointment) => appointment.starts_at)).toEqual(screens.agenda.map((appointment) => appointment.starts_at));
  expect(screens.today.map((appointment) => appointment.starts_at)).toEqual(screens.agenda.map((appointment) => appointment.starts_at));
  expect(screens.nextAppointment[0]?.starts_at).toBe("2026-07-09T09:00:00.000Z");
  expect(screens.clientUpcoming.map((appointment) => appointment.startsAt)).toEqual([
    "2026-07-09T09:00:00.000Z",
    "2026-07-09T12:00:00.000Z",
    "2026-07-09T14:00:00.000Z",
  ]);
  expect(screens.clientHistory.map((appointment) => appointment.startsAt)).toEqual([
    "2026-07-09T14:00:00.000Z",
    "2026-07-09T12:00:00.000Z",
    "2026-07-09T09:00:00.000Z",
  ]);
});

test("supports separated appointment_date and appointment_time fields", () => {
  const ordered = sortAppointmentsChronologically(
    [
      { appointment_date: "2026-07-09", appointment_time: "14:00" },
      { appointment_date: "2026-07-09", appointment_time: "09:00" },
      { appointment_date: "2026-07-09", appointment_time: "12:00" },
    ],
    "future",
  );

  expect(ordered.map((appointment) => appointment.appointment_time)).toEqual(["09:00", "12:00", "14:00"]);
});
