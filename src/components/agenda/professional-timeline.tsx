import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarPlus, Clock3, LockKeyhole, Sparkles, UserRound, X } from "lucide-react";
import {
  getTimelineSlotMinutes,
  getProfessionalTimelineBounds,
  layoutProfessionalAppointments,
  type ProfessionalTimelineAppointment,
  type ProfessionalTimelinePerson,
} from "./professional-timeline-utils";
import { formatStudioTime, getZonedDateParts, getZonedMinutes } from "@/lib/studio-time";

const MOBILE_HOUR_HEIGHT = 56;
const DESKTOP_HOUR_HEIGHT = 82;
const MOBILE_TIME_GUTTER = 46;
const DESKTOP_TIME_GUTTER = 58;

export function ProfessionalTimeline({
  date,
  now,
  professionals,
  appointments,
  availability,
  timeZone,
  focusRequestKey = 0,
  onOpenAppointment,
  onOpenBlock,
  onCreateAtSlot,
  onBlockAtSlot,
}: {
  date: Date;
  now: Date;
  professionals: ProfessionalTimelinePerson[];
  appointments: ProfessionalTimelineAppointment[];
  availability?: Array<{ startMinutes: number; endMinutes: number }>;
  timeZone: string;
  focusRequestKey?: number;
  onOpenAppointment: (appointment: ProfessionalTimelineAppointment) => void;
  onOpenBlock: (block: ProfessionalTimelineAppointment) => void;
  onCreateAtSlot: (staffId: string, minutes: number, mode: "standard" | "fit") => void;
  onBlockAtSlot: (staffId: string, minutes: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAutoScrollKeyRef = useRef("");
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [mobile, setMobile] = useState(false);
  const [mobileProfessionalId, setMobileProfessionalId] = useState(
    professionals[0]?.id ?? "unassigned",
  );
  const [slotMenu, setSlotMenu] = useState<{ staffId: string; minutes: number } | null>(null);
  const hourHeight = mobile ? MOBILE_HOUR_HEIGHT : DESKTOP_HOUR_HEIGHT;
  const timeGutter = mobile ? MOBILE_TIME_GUTTER : DESKTOP_TIME_GUTTER;
  // Cancelled appointments remain in the agenda history, but they are no longer
  // operational entries: they must not consume timeline space or affect bounds.
  const operationalAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.status !== "cancelled"),
    [appointments],
  );
  const bounds = useMemo(
    () => getProfessionalTimelineBounds(operationalAppointments, availability, timeZone),
    [availability, operationalAppointments, timeZone],
  );
  const timelineHeight = (bounds.endHour - bounds.startHour) * hourHeight;
  const hours = Array.from(
    { length: bounds.endHour - bounds.startHour + 1 },
    (_, index) => bounds.startHour + index,
  );
  const displayProfessionals = useMemo(
    () =>
      professionals.length > 0
        ? professionals
        : [{ id: "unassigned", name: "Agenda", avatarUrl: null }],
    [professionals],
  );
  const appointmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const appointment of operationalAppointments) {
      if (appointment.kind === "block") continue;
      counts.set(appointment.staffId, (counts.get(appointment.staffId) ?? 0) + 1);
    }
    return counts;
  }, [operationalAppointments]);
  const positionedByProfessional = useMemo(() => {
    const grouped = new Map<string, ProfessionalTimelineAppointment[]>();
    for (const appointment of operationalAppointments) {
      const current = grouped.get(appointment.staffId);
      if (current) current.push(appointment);
      else grouped.set(appointment.staffId, [appointment]);
    }
    const positioned = new Map<string, ReturnType<typeof layoutProfessionalAppointments>>();
    for (const [staffId, staffAppointments] of grouped) {
      positioned.set(
        staffId,
        layoutProfessionalAppointments(staffAppointments, bounds.startHour, hourHeight, timeZone),
      );
    }
    return positioned;
  }, [bounds.startHour, hourHeight, operationalAppointments, timeZone]);
  const visibleProfessionals = useMemo(
    () =>
      mobile
        ? displayProfessionals.filter((person) => person.id === mobileProfessionalId)
        : displayProfessionals,
    [displayProfessionals, mobile, mobileProfessionalId],
  );
  const safeVisibleProfessionals =
    visibleProfessionals.length > 0 ? visibleProfessionals : [displayProfessionals[0]];
  const columnWidth = mobile ? "minmax(0, 1fr)" : "minmax(13rem, 1fr)";
  const gridColumns = `${timeGutter}px repeat(${safeVisibleProfessionals.length}, ${columnWidth})`;
  const today = sameStudioDay(date, now, timeZone);
  const nowMinutes = getZonedMinutes(now, timeZone);
  const currentTop = ((nowMinutes - bounds.startHour * 60) / 60) * hourHeight;
  const showCurrentTime = today && currentTop >= 0 && currentTop <= timelineHeight;
  const dateKey = date.getTime();

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    // The global shell defaults to vertical-only gestures. While the agenda is
    // mounted, allow both axes so the professional strip can receive native
    // horizontal swipes; restore the previous page behaviour on exit.
    const previousTouchAction = document.documentElement.style.touchAction;
    document.documentElement.style.touchAction = "manipulation";
    return () => {
      document.documentElement.style.touchAction = previousTouchAction;
    };
  }, []);

  useEffect(() => {
    if (!displayProfessionals.some((person) => person.id === mobileProfessionalId)) {
      setMobileProfessionalId(displayProfessionals[0].id);
    }
  }, [displayProfessionals, mobileProfessionalId]);

  useEffect(() => {
    const autoScrollKey = `${dateKey}:${mobile ? "mobile" : "desktop"}:${mobileProfessionalId}:${focusRequestKey}`;
    if (lastAutoScrollKeyRef.current === autoScrollKey) return;
    lastAutoScrollKeyRef.current = autoScrollKey;
    const frame = window.requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const target = showCurrentTime ? currentTop - scrollRef.current.clientHeight * 0.32 : 0;
      if (mobile) {
        const timelineTop = scrollRef.current.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
          top: Math.max(
            0,
            timelineTop + (showCurrentTime ? currentTop : 0) - window.innerHeight * 0.32,
          ),
          behavior: "smooth",
        });
        return;
      }
      scrollRef.current.scrollTop = Math.max(0, target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentTop, dateKey, focusRequestKey, mobile, mobileProfessionalId, showCurrentTime]);

  useEffect(
    () => () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    },
    [],
  );

  function clearLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = null;
    longPressStartRef.current = null;
  }

  return (
    <section
      className="agenda-timeline agenda-touch-surface relative z-0 isolate select-none overflow-visible bg-background touch-auto md:overflow-hidden md:rounded-2xl md:border md:border-border/80 md:bg-card md:shadow-sm"
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <div
        className={`agenda-professionals relative z-20 flex min-h-[4.25rem] snap-x snap-mandatory scroll-smooth scroll-px-2 gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border/60 bg-card/95 px-2 py-1.5 backdrop-blur-xl touch-pan-x [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden ${
          displayProfessionals.length <= 2 ? "justify-center" : "justify-start"
        }`}
        aria-label="Profissionais da agenda"
        data-testid="agenda-professionals"
      >
        {displayProfessionals.map((person) => (
          <button
            key={person.id}
            type="button"
            onClick={() => {
              setMobileProfessionalId(person.id);
              setSlotMenu(null);
            }}
            className={`agenda-compact-control inline-flex h-14 min-h-0 shrink-0 snap-start items-center gap-2 rounded-xl border px-2.5 text-left text-[11px] font-bold transition ${
              person.id === mobileProfessionalId
                ? "border-foreground bg-foreground text-background shadow-sm"
                : "border-border/70 bg-muted/45 text-muted-foreground"
            } ${
              displayProfessionals.length === 1
                ? "w-[min(100%,16rem)]"
                : displayProfessionals.length === 2
                  ? "w-[calc(50%_-_0.25rem)] min-w-0"
                  : "w-[11rem]"
            }`}
            aria-pressed={person.id === mobileProfessionalId}
            aria-label={`${person.name}, ${appointmentCounts.get(person.id) ?? 0} ${
              (appointmentCounts.get(person.id) ?? 0) === 1 ? "marcação" : "marcações"
            }`}
          >
            <ProfessionalAvatar person={person} compact />
            <span className="min-w-0 overflow-hidden">
              <span className="block max-w-28 truncate text-xs">{person.name}</span>
              <span className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-[9px] font-semibold opacity-80">
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 tabular-nums ${
                    person.id === mobileProfessionalId
                      ? "bg-background/15 text-background"
                      : "bg-background text-foreground"
                  }`}
                >
                  {appointmentCounts.get(person.id) ?? 0}
                </span>
                {(appointmentCounts.get(person.id) ?? 0) === 1 ? "agendamento" : "agendamentos"}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="h-auto max-h-none overflow-visible md:max-h-[72dvh] md:overflow-auto md:overscroll-contain md:scroll-smooth md:[scrollbar-width:thin]"
        data-testid="professional-timeline-scroll"
      >
        <div
          className="relative min-w-full"
          style={{
            width: mobile
              ? "100%"
              : Math.max(760, timeGutter + safeVisibleProfessionals.length * 220),
          }}
        >
          <div
            className="sticky top-0 z-40 hidden border-b border-border/80 bg-card/95 backdrop-blur-xl md:grid"
            style={{ gridTemplateColumns: gridColumns }}
          >
            <div className="sticky left-0 z-50 grid h-14 place-items-center border-r border-border/70 bg-card/95">
              <Clock3 className="h-4 w-4 text-muted-foreground" />
            </div>
            {safeVisibleProfessionals.map((person) => {
              const count = appointmentCounts.get(person.id) ?? 0;
              return (
                <div
                  key={person.id}
                  className={`min-w-0 items-center gap-2.5 border-r border-border/60 px-3 ${mobile ? "hidden" : "flex"}`}
                >
                  <ProfessionalAvatar person={person} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold" title={person.name}>
                      {person.name}
                    </p>
                    <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                      {count} {count === 1 ? "marcação" : "marcações"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="relative grid"
            style={{ gridTemplateColumns: gridColumns, height: timelineHeight }}
            data-testid="agenda-timeline-grid"
          >
            <div className="sticky left-0 z-30 border-r border-border/60 bg-background">
              {hours.map((hour, index) => (
                <span
                  key={hour}
                  className={`absolute inset-x-1 whitespace-nowrap text-right font-mono text-[10px] font-black leading-none tabular-nums text-foreground/75 ${
                    index === 0
                      ? "translate-y-0"
                      : index === hours.length - 1
                        ? "-translate-y-full"
                        : "-translate-y-1/2"
                  }`}
                  style={{ top: (hour - bounds.startHour) * hourHeight }}
                >
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
              {hours.slice(0, -1).flatMap((hour) =>
                [15, 30, 45].map((minute) => (
                  <span
                    key={`${hour}:${minute}`}
                    className={`absolute inset-x-1 -translate-y-1/2 whitespace-nowrap text-right font-mono leading-none tabular-nums ${
                      minute === 30
                        ? "text-[8px] font-semibold text-muted-foreground/75"
                        : "text-[7px] font-medium text-muted-foreground/45"
                    }`}
                    style={{
                      top: (hour - bounds.startHour) * hourHeight + (minute / 60) * hourHeight,
                    }}
                  >
                    {String(hour).padStart(2, "0")}:{minute}
                  </span>
                )),
              )}
            </div>

            {safeVisibleProfessionals.map((person) => {
              const positioned = positionedByProfessional.get(person.id) ?? [];
              return (
                <div
                  key={person.id}
                  className="relative min-w-0 cursor-crosshair select-none border-r border-border/60 bg-background/20 touch-pan-y"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("[data-timeline-entry]")) return;
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    const minutes = getTimelineSlotMinutes(
                      event.clientY,
                      rect.top,
                      bounds.startHour,
                      bounds.endHour,
                      hourHeight,
                    );
                    setSlotMenu({ staffId: person.id, minutes });
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest("[data-timeline-entry]")) return;
                    clearLongPress();
                    longPressStartRef.current = { x: event.clientX, y: event.clientY };
                    const rect = event.currentTarget.getBoundingClientRect();
                    const minutes = getTimelineSlotMinutes(
                      event.clientY,
                      rect.top,
                      bounds.startHour,
                      bounds.endHour,
                      hourHeight,
                    );
                    longPressTimerRef.current = window.setTimeout(() => {
                      suppressClickRef.current = true;
                      setSlotMenu({ staffId: person.id, minutes });
                      if ("vibrate" in navigator) navigator.vibrate(18);
                    }, 480);
                  }}
                  onPointerMove={(event) => {
                    const start = longPressStartRef.current;
                    if (!start) return;
                    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
                      clearLongPress();
                    }
                  }}
                  onPointerUp={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onPointerLeave={clearLongPress}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t border-border/55"
                      style={{ top: (hour - bounds.startHour) * hourHeight }}
                    >
                      {[15, 30, 45].map((minute) => (
                        <span
                          key={minute}
                          className={`absolute inset-x-0 border-t ${
                            minute === 30
                              ? "border-dashed border-border/30"
                              : "border-dotted border-border/18"
                          }`}
                          style={{ top: (minute / 60) * hourHeight }}
                        />
                      ))}
                    </div>
                  ))}

                  {slotMenu?.staffId === person.id && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-[5] border-y border-foreground/25 bg-foreground/[0.055]"
                      style={{
                        top: ((slotMenu.minutes - bounds.startHour * 60) / 60) * hourHeight,
                        height: hourHeight / 4,
                      }}
                      data-testid="agenda-selected-slot"
                      aria-hidden="true"
                    >
                      <span className="absolute left-1 top-1/2 -translate-y-1/2 rounded bg-card/90 px-1 font-mono text-[7px] font-black tabular-nums text-foreground shadow-sm">
                        {formatMinutes(slotMenu.minutes)}
                      </span>
                    </div>
                  )}

                  {positioned.map((appointment) => {
                    const left = (appointment.lane / appointment.laneCount) * 100;
                    const width = 100 / appointment.laneCount;
                    const blocked = appointment.kind === "block";
                    return blocked ? (
                      <button
                        key={appointment.id}
                        type="button"
                        onClick={() => onOpenBlock(appointment)}
                        className="absolute z-10 overflow-hidden rounded-md border border-slate-300/80 border-l-[3px] bg-slate-100/95 px-1.5 py-0.5 text-left text-slate-800 transition hover:z-20 hover:bg-slate-200/90 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-100 dark:hover:bg-slate-500/25"
                        style={{
                          top: appointment.top,
                          height: appointment.height,
                          left: `calc(${left}% + 3px)`,
                          width: `calc(${width}% - 6px)`,
                        }}
                        aria-label={`Bloqueado, ${formatTime(appointment.startsAt, timeZone)} a ${formatTime(appointment.endsAt, timeZone)}, ${appointment.clientName}`}
                        data-timeline-entry="block"
                      >
                        <span className="flex min-w-0 items-center gap-1 font-mono text-[9px] font-black leading-none tabular-nums">
                          <LockKeyhole className="size-2.5 shrink-0" />
                          <span className="truncate">
                            {formatTime(appointment.startsAt, timeZone)} – {formatTime(appointment.endsAt, timeZone)}
                          </span>
                        </span>
                        {appointment.height >= 28 && (
                          <span className="mt-0.5 block truncate text-[10px] font-black leading-tight">
                            {appointment.clientName}
                          </span>
                        )}
                      </button>
                    ) : (
                      <button
                        key={appointment.id}
                        type="button"
                        onClick={() => onOpenAppointment(appointment)}
                        className={`absolute z-10 overflow-hidden rounded-lg border border-l-[3px] px-1.5 py-0.5 text-left shadow-[0_1px_2px_hsl(0_0%_0%/0.06)] transition hover:z-20 hover:shadow-sm focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:rounded-xl md:px-2.5 md:py-1.5 ${appointmentTone(appointment.status, appointment.id)}`}
                        style={{
                          top: appointment.top,
                          height: appointment.height,
                          left: `calc(${left}% + 3px)`,
                          width: `calc(${width}% - 6px)`,
                        }}
                        aria-label={`${formatTime(appointment.startsAt, timeZone)}, ${appointment.clientName}, ${appointment.serviceName}`}
                        data-timeline-entry="appointment"
                      >
                        <span className="flex min-w-0 items-center justify-between gap-1">
                          <span className="shrink-0 whitespace-nowrap font-mono text-[9px] font-black leading-none tabular-nums md:text-[10px]">
                            {formatTime(appointment.startsAt, timeZone)} – {formatTime(appointment.endsAt, timeZone)}
                          </span>
                          {appointment.attendancePending ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.04em] text-amber-900 dark:text-amber-200">
                              <Clock3 className="size-2.5" />
                              Confirmar
                            </span>
                          ) : appointment.status === "completed" ? (
                            <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-900 dark:text-emerald-200">
                              Compareceu
                            </span>
                          ) : appointment.status === "no_show" ? (
                            <span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[8px] font-black uppercase text-rose-900 dark:text-rose-200">
                              Faltou
                            </span>
                          ) : appointment.manualFit ? (
                            <span
                              className="shrink-0 rounded-full border border-violet-500/25 bg-violet-500/12 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.05em] text-violet-800 dark:text-violet-200"
                              title="Encaixe manual"
                            >
                              <span className="md:hidden">E</span>
                              <span className="hidden md:inline">Encaixe</span>
                            </span>
                          ) : (
                            <span
                              className="shrink-0 text-xs font-black leading-none opacity-60"
                              aria-hidden="true"
                            >
                              ···
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] font-black leading-tight md:mt-1 md:text-xs">
                          {appointment.clientName}
                        </span>
                        {appointment.height >= 38 && (
                          <span className="mt-0.5 block truncate text-[9px] font-medium leading-tight opacity-80 md:text-[10px]">
                            {appointment.serviceName}
                          </span>
                        )}
                        {appointment.height >= 58 && (
                          <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[9px] font-semibold opacity-70">
                            <span className="truncate">
                              {appointment.professionalName} · {appointment.durationLabel}
                            </span>
                            {appointment.valueLabel && (
                              <span className="shrink-0 whitespace-nowrap">
                                {appointment.valueLabel}
                              </span>
                            )}
                          </span>
                        )}
                        {appointment.height >= 82 && (
                          <span className="mt-1 inline-flex rounded-full bg-background/55 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.06em]">
                            {statusLabel(appointment.status)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {showCurrentTime && (
              <div
                className="pointer-events-none absolute inset-x-0 z-20 overflow-visible"
                style={{ top: currentTop }}
                aria-label="Horário atual"
              >
                <span
                  className="absolute right-0 top-0 border-t border-rose-500/80"
                  style={{ left: timeGutter }}
                >
                  <span className="absolute left-0 top-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500" />
                  <span className="absolute right-1 top-0 -translate-y-1/2 whitespace-nowrap rounded-full bg-rose-500 px-1.5 py-0.5 font-mono text-[8px] font-black leading-none tabular-nums text-white shadow-sm">
                    Agora {formatTime(now.toISOString(), timeZone)}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {slotMenu && (
        <div
          className="fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),8px)+5.6rem)] z-[60] max-h-[min(20rem,calc(100dvh-8rem))] overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-2xl md:absolute md:bottom-3 md:left-auto md:right-4 md:w-72"
          data-testid="agenda-slot-menu"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                Horário livre
              </p>
              <p className="font-mono text-sm font-black tabular-nums">
                {formatMinutes(slotMenu.minutes)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSlotMenu(null)}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label="Fechar ações do horário"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="grid gap-1">
            <SlotAction
              icon={<CalendarPlus className="size-4" />}
              label="Nova Marcação"
              onClick={() => {
                onCreateAtSlot(slotMenu.staffId, slotMenu.minutes, "standard");
                setSlotMenu(null);
              }}
            />
            <SlotAction
              icon={<Sparkles className="size-4" />}
              label="Criar encaixe"
              onClick={() => {
                onCreateAtSlot(slotMenu.staffId, slotMenu.minutes, "fit");
                setSlotMenu(null);
              }}
            />
            <SlotAction
              icon={<LockKeyhole className="size-4" />}
              label="Bloquear horário"
              onClick={() => {
                onBlockAtSlot(slotMenu.staffId, slotMenu.minutes);
                setSlotMenu(null);
              }}
            />
            <SlotAction
              icon={<X className="size-4" />}
              label="Cancelar"
              onClick={() => setSlotMenu(null)}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 overflow-x-auto border-t border-border/50 bg-card/85 px-2.5 py-1.5 text-[8px] font-semibold text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:gap-4 md:bg-muted/25 md:px-3 md:text-[9px]">
        <Legend tone="bg-sky-300" label="Confirmada" />
        <Legend tone="bg-amber-300" label="Pendente" />
        <Legend tone="bg-emerald-300" label="Concluída" />
        <Legend tone="bg-rose-300" label="Cancelada" />
        <Legend tone="bg-violet-300" label="Encaixe" />
        <span className="ml-auto hidden whitespace-nowrap sm:inline">
          Toque ou mantenha pressionado um horário livre
        </span>
      </div>
    </section>
  );
}

function SlotAction({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-xs font-bold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      <span>{label}</span>
      {hint && (
        <span className="ml-auto text-[9px] font-semibold text-muted-foreground">{hint}</span>
      )}
    </button>
  );
}

function formatMinutes(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function ProfessionalAvatar({
  person,
  compact,
}: {
  person: ProfessionalTimelinePerson;
  compact?: boolean;
}) {
  const size = compact ? "size-8 text-[9px]" : "size-9 text-[10px]";
  if (person.avatarUrl) {
    return (
      <img
        src={person.avatarUrl}
        alt=""
        draggable={false}
        className={`${size} shrink-0 rounded-full object-cover ring-2 ring-background`}
      />
    );
  }
  const initials = person.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={`${size} grid shrink-0 place-items-center rounded-full bg-violet-500/12 font-black text-violet-700 ring-2 ring-background dark:text-violet-300`}
    >
      {initials || <UserRound className="h-3 w-3" />}
    </span>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`size-2 rounded-full ${tone}`} />
      {label}
    </span>
  );
}

function appointmentTone(status: string, id: string) {
  if (status === "cancelled" || status === "no_show") {
    return "border-rose-300/80 bg-rose-100 text-rose-950 opacity-75 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-100";
  }
  if (status === "completed") {
    return "border-emerald-300/80 bg-emerald-100 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-100";
  }
  if (status === "pending" || status === "pending_payment") {
    return "border-amber-300/80 bg-amber-100 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-100";
  }
  const alternatives = [
    "border-sky-300/80 bg-sky-100 text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-100",
    "border-violet-300/80 bg-violet-100 text-violet-950 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-100",
    "border-cyan-300/80 bg-cyan-100 text-cyan-950 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-100",
  ];
  const index = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % alternatives.length;
  return alternatives[index];
}

function statusLabel(status: string) {
  if (status === "completed") return "Concluída";
  if (status === "cancelled") return "Cancelada";
  if (status === "no_show") return "Falta";
  if (status === "pending_payment") return "Pagamento";
  if (status === "pending") return "Pendente";
  return "Confirmada";
}

function formatTime(value: string, timeZone: string) {
  return formatStudioTime(value, timeZone);
}

function sameStudioDay(a: Date, b: Date, timeZone: string) {
  const first = getZonedDateParts(a, timeZone);
  const second = getZonedDateParts(b, timeZone);
  return first.year === second.year && first.month === second.month && first.day === second.day;
}
