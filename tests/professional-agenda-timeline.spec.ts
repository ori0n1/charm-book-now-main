import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getProfessionalTimelineBounds,
  layoutProfessionalAppointments,
  type ProfessionalTimelineAppointment,
} from "../src/components/agenda/professional-timeline-utils";

function appointment(
  id: string,
  staffId: string,
  startsAt: string,
  endsAt: string,
): ProfessionalTimelineAppointment {
  return {
    id,
    staffId,
    startsAt,
    endsAt,
    status: "confirmed",
    clientName: `Cliente ${id}`,
    serviceName: "Serviço",
    durationLabel: "60 min",
    privateDetails: true,
  };
}

test("posiciona marcações pela hora e duração reais", () => {
  const result = layoutProfessionalAppointments(
    [
      appointment(
        "a",
        "staff-a",
        "2026-07-30T09:00:00+01:00",
        "2026-07-30T10:00:00+01:00",
      ),
      appointment(
        "b",
        "staff-a",
        "2026-07-30T09:30:00+01:00",
        "2026-07-30T10:30:00+01:00",
      ),
    ],
    8,
    82,
  );

  expect(result[0].top).toBe(82);
  expect(result[0].height).toBe(82);
  expect(result[0].laneCount).toBe(2);
  expect(result[1].lane).toBe(1);
});

test("mantém limites úteis num dia vazio ou com horários extremos", () => {
  expect(getProfessionalTimelineBounds([])).toEqual({ startHour: 8, endHour: 20 });
  expect(
    getProfessionalTimelineBounds([
      appointment(
        "early",
        "staff-a",
        "2026-07-30T06:30:00+01:00",
        "2026-07-30T07:15:00+01:00",
      ),
      appointment(
        "late",
        "staff-b",
        "2026-07-30T21:00:00+01:00",
        "2026-07-30T22:00:00+01:00",
      ),
    ]),
  ).toEqual({ startHour: 5, endHour: 23 });
});

test("configura a agenda como início sem alterar ações existentes", async () => {
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );
  const authSource = await readFile(resolve(process.cwd(), "src/lib/auth-landing.ts"), "utf8");
  const manifest = JSON.parse(
    await readFile(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8"),
  ) as { id: string; start_url: string };

  expect(agendaSource).toContain("<ProfessionalTimeline");
  expect(agendaSource).toContain("<TimelineAppointmentDrawer");
  expect(agendaSource).toContain("markPresence(timelineDetailAppt");
  expect(agendaSource).toContain("setRescheduleApptId(timelineDetailAppt.id)");
  expect(agendaSource).toContain("setPaymentDialogAppt(timelineDetailAppt)");
  expect(agendaSource).toContain("cancelAppointment(timelineDetailAppt.id)");
  expect(authSource).toContain('return "/admin/agenda"');
  expect(manifest.id).toBe("/admin");
  expect(manifest.start_url).toBe("/admin/agenda");
});
