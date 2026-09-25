import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const migrationPath = "supabase/migrations/20260831190000_flexible_agenda_safe_overrides.sql";

test("database keeps overlap blocked by default and scopes overrides to service-role RPCs", async () => {
  const sql = await readFile(migrationPath, "utf8");

  expect(sql).toContain("enforce_appointment_schedule_overlap_trigger");
  expect(sql).toContain("pg_advisory_xact_lock");
  expect(sql).toContain("bellza.allow_manual_overlap");
  expect(sql.match(/set_config\('bellza\.allow_manual_overlap'/g)).toHaveLength(3);
  expect(sql).toContain("ERRCODE = '23P01'");
  expect(sql).toContain("schedule_conflict_changed");
  expect(sql).toContain("p_expected_conflict_ids");
  expect(sql).toMatch(
    /REVOKE ALL ON FUNCTION public\.move_studio_appointment[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  expect(sql).toMatch(
    /GRANT EXECUTE ON FUNCTION public\.move_studio_appointment[\s\S]*TO service_role/,
  );
  expect(sql).toMatch(
    /GRANT EXECUTE ON FUNCTION public\.create_studio_manual_fit[\s\S]*TO service_role/,
  );
});

test("move, swap and duration changes are serialized, atomic and audited", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const move = functionBody(sql, "move_studio_appointment", "swap_studio_appointments");
  const swap = functionBody(sql, "swap_studio_appointments", "create_studio_manual_fit");

  expect(move).toContain("FOR UPDATE");
  expect(move).toContain("appointment_schedule_events");
  expect(move).toContain("p_operation = 'duration'");
  expect(swap).toContain("ORDER BY id FOR UPDATE");
  expect(swap).toContain("correlation_id");
  expect(swap.match(/UPDATE public\.appointments SET/g)).toHaveLength(2);
  expect(swap).not.toMatch(/COMMIT|ROLLBACK/);
});

test("schedule operations preserve appointment prices, payments and service snapshots", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const move = functionBody(sql, "move_studio_appointment", "swap_studio_appointments");
  const swap = functionBody(sql, "swap_studio_appointments", "create_studio_manual_fit");

  for (const operation of [move, swap]) {
    expect(operation).not.toMatch(/UPDATE public\.appointment_services/);
    expect(operation).not.toMatch(/UPDATE public\.payment_intents/);
    expect(operation).not.toMatch(/UPDATE public\.cash_register_movements/);
    expect(operation).not.toMatch(/total_price\s*=/);
  }
  expect(move).toContain("total_duration_min = p_duration_min");
  expect(move).toContain("duration_overridden");
});

test("agenda exposes quick actions and never confirms a conflict in the first step", async () => {
  const agenda = await readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");
  const server = await readFile("src/lib/studio-appointment.functions.ts", "utf8");
  const timeline = await readFile("src/components/agenda/professional-timeline.tsx", "utf8");
  const drawer = await readFile("src/components/agenda/timeline-appointment-drawer.tsx", "utf8");

  for (const label of [
    'label: "Mover"',
    'label: "Trocar"',
    'label: "Encaixar"',
    'label: "Editar"',
  ]) {
    expect(agenda).toContain(label);
  }
  expect(agenda).toContain("Antes → Depois");
  expect(agenda).toContain("Deseja criar um encaixe mesmo assim?");
  expect(agenda).toContain(
    "decisionPreview.hasConflict && !sameScheduleDecision(decisionPreview, conflictPreview)",
  );
  expect(agenda).toContain("conflict.appointmentId");
  expect(agenda).toContain('operation: "duration"');
  expect(server).toContain("p_confirm_overlap: data.confirmOverlap");
  expect(server).toContain("dispatchRescheduleNotifications");
  expect(server).toContain("assertAppointmentAccess");
  expect(server).toContain("assertScheduleStaffAccess");
  expect(timeline).toContain('title="Encaixe manual"');
  expect(drawer).toContain("Histórico de alterações");
  expect(drawer).toContain('data-testid="appointment-quick-actions"');
  expect(drawer.indexOf('data-testid="appointment-quick-actions"')).toBeLessThan(
    drawer.indexOf('label="Data"'),
  );
  expect(agenda).not.toContain("if (appointment.attendancePending)");
});

test("conflict explanation remains contained on mobile and desktop", async ({ page }) => {
  await page.goto("/login");
  await page.setContent(`
    <link rel="stylesheet" href="/src/styles.css" />
    <main class="admin-content w-full p-2">
      <section data-testid="conflict" class="w-full min-w-0 max-w-xl rounded-2xl border border-amber-300 bg-amber-50 p-3">
        <div class="flex min-w-0 items-start gap-2.5">
          <span class="size-4 shrink-0">!</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-black">Este horário já está ocupado</p>
            <p class="mt-1 max-w-full break-words text-xs leading-relaxed">A Bellza não fará a alteração silenciosamente. Reveja o impacto e confirme apenas se consegue atender as duas marcações.</p>
          </div>
        </div>
        <div class="mt-2 min-w-0 rounded-xl border bg-white px-3 py-2 text-xs">
          <p class="break-words font-black">Cliente com um nome extremamente comprido · Serviço detalhado</p>
          <p class="break-words">Profissional · ocupado 10:00–10:45 · Sobreposição 10:30–10:45</p>
        </div>
      </section>
    </main>
  `);

  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const dimensions = await page.locator("[data-testid='conflict']").evaluate((element) => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    }));
    expect(dimensions.documentWidth, `document at ${width}px`).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
    expect(dimensions.scrollWidth, `conflict card at ${width}px`).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(width);
  }
});

function functionBody(sql: string, name: string, nextName: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}
