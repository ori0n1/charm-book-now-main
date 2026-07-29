import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  buildAgendaDayGroups,
  findNextOperationalAppointmentId,
  formatAgendaDayTitle,
  getAgendaTimelineState,
} from "../src/lib/agenda-list-presentation";

function localIso(year: number, month: number, day: number, hour: number, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

test("uses explicit complete dates instead of generic future and past buckets", () => {
  const now = new Date(2026, 6, 29, 11, 30);
  const groups = buildAgendaDayGroups(
    [
      {
        id: "past",
        starts_at: localIso(2026, 7, 28, 9),
        ends_at: localIso(2026, 7, 28, 10),
        status: "completed",
      },
      {
        id: "tomorrow-late",
        starts_at: localIso(2026, 7, 30, 15),
        ends_at: localIso(2026, 7, 30, 16),
        status: "confirmed",
      },
      {
        id: "today",
        starts_at: localIso(2026, 7, 29, 14),
        ends_at: localIso(2026, 7, 29, 15),
        status: "confirmed",
      },
      {
        id: "tomorrow-early",
        starts_at: localIso(2026, 7, 30, 9),
        ends_at: localIso(2026, 7, 30, 10),
        status: "confirmed",
      },
    ],
    now,
  );

  expect(groups.map((group) => group.key)).toEqual(["2026-07-29", "2026-07-30", "2026-07-28"]);
  expect(groups[0].title).toContain("Hoje •");
  expect(groups[0].title).toContain("29 de julho");
  expect(groups[1].title).toContain("Amanhã •");
  expect(groups[1].appointments.map((appointment) => appointment.id)).toEqual([
    "tomorrow-early",
    "tomorrow-late",
  ]);
  expect(groups[2].title).toContain("28 de julho");
  expect(groups[2].isPast).toBe(true);
});

test("marks current, past and future times and selects the next operational appointment", () => {
  const now = new Date(2026, 6, 29, 11, 30);
  const appointments = [
    {
      id: "past",
      starts_at: localIso(2026, 7, 29, 9),
      ends_at: localIso(2026, 7, 29, 10),
      status: "completed",
    },
    {
      id: "current",
      starts_at: localIso(2026, 7, 29, 11),
      ends_at: localIso(2026, 7, 29, 12),
      status: "confirmed",
    },
    {
      id: "cancelled-future",
      starts_at: localIso(2026, 7, 29, 12),
      ends_at: localIso(2026, 7, 29, 13),
      status: "cancelled",
    },
    {
      id: "future",
      starts_at: localIso(2026, 7, 29, 14),
      ends_at: localIso(2026, 7, 29, 15),
      status: "confirmed",
    },
  ];

  expect(getAgendaTimelineState(appointments[0], now)).toBe("past");
  expect(getAgendaTimelineState(appointments[1], now)).toBe("current");
  expect(getAgendaTimelineState(appointments[3], now)).toBe("future");
  expect(findNextOperationalAppointmentId(appointments, now)).toBe("current");
});

test("keeps every required appointment detail visible in the compact card", async () => {
  const source = await readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");

  expect(source).toContain("data-agenda-day={label}");
  expect(source).toContain("data-next-appointment={isNextAppointment ? \"true\" : undefined}");
  expect(source).toContain("Próximo atendimento");
  expect(source).toContain("Horário passado");
  expect(source).toContain("Mais tarde");
  expect(source).toContain("{service}");
  expect(source).toContain("{durationLabel}");
  expect(source).toContain("{a.staff.name}");
  expect(source).toContain("<StatusChip status={a.status}");
  expect(source).toContain("{formatEUR(split.serviceTotal)}");
});

test("formats a non-relative day without an ambiguous generic category", () => {
  const now = new Date(2026, 6, 29, 11, 30);
  const title = formatAgendaDayTitle(new Date(2026, 6, 31), now);
  expect(title).toContain("31 de julho");
  expect(title).not.toContain("Próximos");
  expect(title).not.toContain("Passados");
});
