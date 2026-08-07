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
    professionalName: "Profissional",
    durationLabel: "60 min",
    privateDetails: true,
  };
}

test("posiciona marcações pela hora e duração reais", () => {
  const result = layoutProfessionalAppointments(
    [
      appointment("a", "staff-a", "2026-07-30T09:00:00+01:00", "2026-07-30T10:00:00+01:00"),
      appointment("b", "staff-a", "2026-07-30T09:30:00+01:00", "2026-07-30T10:30:00+01:00"),
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
      appointment("early", "staff-a", "2026-07-30T06:30:00+01:00", "2026-07-30T07:15:00+01:00"),
      appointment("late", "staff-b", "2026-07-30T21:00:00+01:00", "2026-07-30T22:00:00+01:00"),
    ]),
  ).toEqual({ startHour: 6, endHour: 22 });
});

test("usa o expediente para dimensionar um dia sem marcações", () => {
  expect(
    getProfessionalTimelineBounds([], [{ startMinutes: 7 * 60, endMinutes: 18 * 60 + 30 }]),
  ).toEqual({
    startHour: 7,
    endHour: 20,
  });
});

test("mantém escala proporcional de 15 a 120 minutos", () => {
  for (const duration of [15, 30, 45, 60, 90, 120]) {
    const startsAt = new Date("2026-07-30T09:00:00+01:00");
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    const [positioned] = layoutProfessionalAppointments(
      [
        appointment(
          `duration-${duration}`,
          "staff-a",
          startsAt.toISOString(),
          endsAt.toISOString(),
        ),
      ],
      8,
      82,
    );
    expect(positioned.height).toBeCloseTo((duration / 60) * 82, 5);
  }
});

test("mantém proporção real na escala compacta do mobile", () => {
  const startsAt = new Date("2026-07-30T13:00:00+01:00");
  const halfHour = new Date(startsAt.getTime() + 30 * 60_000);
  const fullHour = new Date(startsAt.getTime() + 60 * 60_000);
  const [shortAppointment] = layoutProfessionalAppointments(
    [appointment("mobile-30", "staff-a", startsAt.toISOString(), halfHour.toISOString())],
    8,
    56,
  );
  const [longAppointment] = layoutProfessionalAppointments(
    [appointment("mobile-60", "staff-a", startsAt.toISOString(), fullHour.toISOString())],
    8,
    56,
  );

  expect(shortAppointment.height).toBe(28);
  expect(longAppointment.height).toBe(56);
  expect(longAppointment.top).toBe(shortAppointment.top);
});

test("reutiliza o modal atual ao tocar num horário livre", async () => {
  const timelineSource = await readFile(
    resolve(process.cwd(), "src/components/agenda/professional-timeline.tsx"),
    "utf8",
  );
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );

  expect(timelineSource).toContain("Math.round(rawMinutes / 15) * 15");
  expect(timelineSource).toContain('label="Criar encaixe"');
  expect(timelineSource).not.toContain('label="Novo agendamento"');
  expect(timelineSource).toContain('label="Bloquear horário"');
  expect(timelineSource).toContain('label="Cancelar"');
  expect(timelineSource).toContain("onBlockAtSlot(slotMenu.staffId, slotMenu.minutes)");
  expect(timelineSource).toContain("longPressStartRef");
  expect(agendaSource).toContain("initialStaffId={newApptDefaults?.staffId}");
  expect(agendaSource).toContain("initialDate={newApptDefaults?.date}");
  expect(agendaSource).toContain("initialTime={newApptDefaults?.time}");
  expect(agendaSource).toContain("getAgendaWeekDays(selectedDate)");
  expect(agendaSource).toContain("mobileAgendaDays.map((day)");
  expect(agendaSource).toContain("<BlockTimeModal");
});

test("mantém o teste gratuito apenas na página inicial", async () => {
  const adminSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.tsx"),
    "utf8",
  );

  expect(adminSource).toMatch(/isPureTrialBilling\(billingQuery\.data\)\s*&&\s*isDashboardPage/);
});

test("usa uma única rolagem vertical no mobile", async () => {
  const timelineSource = await readFile(
    resolve(process.cwd(), "src/components/agenda/professional-timeline.tsx"),
    "utf8",
  );
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );

  expect(timelineSource).toContain("h-auto max-h-none overflow-visible");
  expect(timelineSource).toContain("md:max-h-[72dvh] md:overflow-auto");
  expect(timelineSource).toContain("const MOBILE_HOUR_HEIGHT = 56");
  expect(timelineSource).toContain("const MOBILE_TIME_GUTTER = 46");
  expect(timelineSource).toContain(
    "style={{ top: (hour - bounds.startHour) * hourHeight + hourHeight / 2 }}",
  );
  expect(timelineSource).toContain("style={{ left: timeGutter }}");
  expect(timelineSource).not.toContain('label="Livre"');
  expect(timelineSource).toContain(
    "fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),8px)+5.6rem)]",
  );
  expect(timelineSource).toContain(
    "hidden border-b border-border/80 bg-card/95 backdrop-blur-xl md:grid",
  );
  expect(agendaSource).toContain('className="hidden min-h-11 items-center justify-between');
  expect(agendaSource).toContain("agenda-timeline-page");
  expect(agendaSource).toContain("pb-0");
  expect(timelineSource).not.toContain("top-[8.7rem]");
});

test("mantém datas contínuas e notificações acima da timeline", async () => {
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );
  const notificationsSource = await readFile(
    resolve(process.cwd(), "src/components/admin-notifications.tsx"),
    "utf8",
  );

  expect(agendaSource).toContain("const [mobileDateRange, setMobileDateRange]");
  expect(agendaSource).toContain("onScroll={extendMobileDateRange}");
  expect(agendaSource).toContain("start: current.start - 14");
  expect(agendaSource).toContain("end: current.end + 14");
  expect(agendaSource).toContain("scroller.scrollLeft += scroller.scrollWidth - previousWidth");
  expect(agendaSource).toContain("setMobileCalendarMonth(dateFromInputValue(dateValue))");
  expect(agendaSource).toContain('aria-label="Abrir filtros da agenda"');
  expect(agendaSource).toContain('className="hidden min-h-12');
  expect(notificationsSource).toContain("createPortal(");
  expect(notificationsSource).toContain("fixed inset-0 z-[120] isolate");
  expect(notificationsSource).toContain('aria-modal="true"');
  expect(notificationsSource).toContain('document.body.style.overflow = "hidden"');
  expect(notificationsSource).toContain("min-h-0 flex-1 overflow-y-auto overscroll-contain");
});

test("mostra bloqueios reais e mantém o modal seguro no mobile", async () => {
  const timelineSource = await readFile(
    resolve(process.cwd(), "src/components/agenda/professional-timeline.tsx"),
    "utf8",
  );
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );

  expect(agendaSource).toContain('.from("staff_time_off")');
  expect(agendaSource).toContain("const timelineBlocks");
  expect(agendaSource).toContain('kind: "block"');
  expect(agendaSource).toContain('type="date"');
  expect(agendaSource).toContain('type="time"');
  expect(agendaSource).toContain('aria-label="Data de início do bloqueio"');
  expect(agendaSource).toContain('aria-label="Hora de fim do bloqueio"');
  expect(agendaSource).toMatch(/role="dialog"\s+aria-modal="true"/);
  expect(timelineSource).toContain('data-timeline-entry="block"');
  expect(timelineSource).toContain('closest("[data-timeline-entry]")');
  expect(timelineSource).toContain("onOpenBlock(appointment)");
  expect(agendaSource).toContain("<ManageBlockTimeModal");
  expect(agendaSource).toContain('.from("staff_time_off")\n      .delete()');
  expect(agendaSource).toContain('.from("staff_time_off")\n      .update({');
  expect(agendaSource).toContain('label="Guardar bloqueio"');
  expect(agendaSource).toContain("Desbloquear horário?");
  expect(agendaSource).toContain("min-[360px]:grid-cols-[minmax(0,1fr)_5.75rem]");
});

test("mantém profissionais visíveis, centralizados e com contadores reais", async () => {
  const timelineSource = await readFile(
    resolve(process.cwd(), "src/components/agenda/professional-timeline.tsx"),
    "utf8",
  );
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );
  const stylesSource = await readFile(resolve(process.cwd(), "src/styles.css"), "utf8");

  expect(timelineSource).toContain('aria-label="Profissionais da agenda"');
  expect(timelineSource).toContain('displayProfessionals.length <= 2 ? "justify-center"');
  expect(timelineSource).not.toContain("mobile && displayProfessionals.length > 1");
  expect(timelineSource).toContain('appointment.status === "cancelled"');
  expect(timelineSource).toContain("appointmentCounts.get(person.id) ?? 0");
  expect(timelineSource).toContain("setMobileProfessionalId(person.id)");
  expect(agendaSource).toContain("focusRequestKey={timelineFocusRequest}");
  expect(agendaSource).toContain("setTimelineFocusRequest((current) => current + 1)");
  expect(agendaSource).toContain("mobile\n                hideProfessional");
  expect(stylesSource).toContain(".admin-shell-agenda .admin-content");
  expect(stylesSource).toContain("--admin-mobile-header-height: 3rem");
});

test("não sobrepõe cabeçalho, profissionais ou campos entre 320px e 430px", async ({ page }) => {
  for (const width of [320, 360, 375, 390, 393, 414, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(`
      <link rel="stylesheet" href="http://127.0.0.1:4178/src/styles.css" />
      <div class="admin-shell admin-shell-agenda min-h-screen overflow-x-hidden bg-background">
        <header data-testid="admin-header" class="flex h-[var(--admin-mobile-header-height)] items-center justify-between border-b px-3 py-1.5">
          <span class="min-w-0 truncate">Boa tarde, Ana</span>
          <span class="shrink-0">Notificações Tema</span>
        </header>
        <main class="admin-main">
          <div class="admin-content px-3 pt-0">
            <div class="agenda-timeline-page -mx-3 flex w-[calc(100%+1.5rem)] max-w-none flex-col gap-0 pb-0">
              <nav data-testid="agenda-start" class="agenda-date-navigation border-y py-1">Agosto de 2026</nav>
              <section class="agenda-timeline">
                <div data-testid="professionals" class="agenda-professionals flex justify-center gap-1.5 overflow-x-auto px-2 py-1">
                  <button class="agenda-compact-control inline-flex h-10 max-w-[calc(50%_-_0.25rem)] shrink-0 items-center gap-2 rounded-xl border px-2">
                    <span class="size-8 shrink-0 rounded-full"></span><span class="min-w-0 truncate">Ana Silva</span><span class="shrink-0">3</span>
                  </button>
                  <button class="agenda-compact-control inline-flex h-10 max-w-[calc(50%_-_0.25rem)] shrink-0 items-center gap-2 rounded-xl border px-2">
                    <span class="size-8 shrink-0 rounded-full"></span><span class="min-w-0 truncate">Paula</span><span class="shrink-0">1</span>
                  </button>
                </div>
              </section>
            </div>
          </div>
        </main>
        <div data-testid="modal" class="fixed inset-0 flex items-end justify-center overflow-x-hidden px-2 pb-2 pt-2">
          <div class="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-[1.25rem] border bg-card">
            <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <label class="grid min-w-0 gap-1.5">Início do bloqueio
                <span data-testid="start-fields" class="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_5.75rem]">
                  <input data-testid="start-date" type="date" class="h-10 min-w-0 w-full" />
                  <input data-testid="start-time" type="time" class="h-10 min-w-0 w-full" />
                </span>
              </label>
              <label class="grid min-w-0 gap-1.5">Fim do bloqueio
                <span class="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_5.75rem]">
                  <input type="date" class="h-10 min-w-0 w-full" />
                  <input type="time" class="h-10 min-w-0 w-full" />
                </span>
              </label>
            </div>
            <div class="grid shrink-0 gap-2 p-3 min-[380px]:grid-cols-[0.85fr_1.15fr]"><button>Cancelar</button><button>Bloquear horário</button></div>
          </div>
        </div>
      </div>
    `);
    await page.waitForFunction(() => document.styleSheets.length > 0);

    const layout = await page.evaluate(() => {
      const rect = (testId: string) =>
        (
          document.querySelector(`[data-testid="${testId}"]`) as HTMLElement
        ).getBoundingClientRect();
      const date = rect("start-date");
      const time = rect("start-time");
      const header = rect("admin-header");
      const agenda = rect("agenda-start");
      const modal = rect("modal");
      const fieldsOverlap = !(
        date.right <= time.left ||
        time.right <= date.left ||
        date.bottom <= time.top ||
        time.bottom <= date.top
      );
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        headerGap: agenda.top - header.bottom,
        fieldsOverlap,
        modalLeft: modal.left,
        modalRight: modal.right,
      };
    });

    expect(layout.documentWidth, `overflow horizontal em ${width}px`).toBeLessThanOrEqual(
      layout.viewportWidth,
    );
    expect(layout.headerGap, `espaço entre cabeçalho e agenda em ${width}px`).toBeLessThanOrEqual(
      1,
    );
    expect(layout.fieldsOverlap, `campos sobrepostos em ${width}px`).toBe(false);
    expect(layout.modalLeft).toBeGreaterThanOrEqual(0);
    expect(layout.modalRight).toBeLessThanOrEqual(width);
  }
});

test("configura a agenda como início sem alterar ações existentes", async () => {
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );
  const authSource = await readFile(resolve(process.cwd(), "src/lib/auth-landing.ts"), "utf8");
  const manifest = JSON.parse(
    await readFile(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8"),
  ) as {
    id: string;
    start_url: string;
  };

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
