import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildTimelineLayout,
  hasAgendaConflict,
  type AgendaTimelineItem,
} from "../src/components/agenda/agenda-timeline-utils";

function appointment(
  id: string,
  start: string,
  end: string,
  staffId = "staff-1",
): AgendaTimelineItem {
  return {
    id,
    startsAt: start,
    endsAt: end,
    status: "confirmed",
    clientName: `Cliente ${id}`,
    serviceName: "Serviço",
    staffId,
    staffName: "Profissional",
    durationLabel: "30 min",
    privateDetails: true,
  };
}

test("organiza horários sobrepostos em faixas sem esconder marcações", () => {
  const items = [
    appointment("a", "2026-07-30T09:00:00+01:00", "2026-07-30T10:00:00+01:00"),
    appointment("b", "2026-07-30T09:30:00+01:00", "2026-07-30T10:30:00+01:00"),
    appointment("c", "2026-07-30T11:00:00+01:00", "2026-07-30T11:30:00+01:00"),
  ];

  const layout = buildTimelineLayout(items, 8, 76);

  expect(layout).toHaveLength(3);
  expect(layout.find((item) => item.id === "a")?.laneCount).toBe(2);
  expect(layout.find((item) => item.id === "b")?.laneCount).toBe(2);
  expect(layout.find((item) => item.id === "c")?.laneCount).toBe(1);
  expect(layout.filter((item) => item.conflict)).toHaveLength(2);
});

test("não sinaliza conflito entre profissionais diferentes", () => {
  const first = appointment(
    "a",
    "2026-07-30T09:00:00+01:00",
    "2026-07-30T10:00:00+01:00",
    "staff-1",
  );
  const second = appointment(
    "b",
    "2026-07-30T09:15:00+01:00",
    "2026-07-30T09:45:00+01:00",
    "staff-2",
  );

  expect(hasAgendaConflict(first, [first, second])).toBe(false);
});

test("preserva ações existentes e torna a agenda o destino principal", async () => {
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );
  const authSource = await readFile(resolve(process.cwd(), "src/lib/auth-landing.ts"), "utf8");
  const manifest = JSON.parse(
    await readFile(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8"),
  ) as { id: string; start_url: string };

  expect(agendaSource).toContain('useState<"day" | "week" | "list">("day")');
  expect(agendaSource).toContain('calendarView === "list"');
  expect(agendaSource).toContain("Editar marcação");
  expect(agendaSource).toContain("Reagendar");
  expect(agendaSource).toContain("Receber pagamento");
  expect(agendaSource).toContain("Cancelar marcação");
  expect(authSource).toContain('return "/admin/agenda"');
  expect(manifest.id).toBe("/admin");
  expect(manifest.start_url).toBe("/admin/agenda");
});
