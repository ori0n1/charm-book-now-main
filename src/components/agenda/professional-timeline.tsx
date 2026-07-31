import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarPlus, Clock3, LockKeyhole, Sparkles, UserRound, X } from "lucide-react";
import {
  getProfessionalTimelineBounds,
  layoutProfessionalAppointments,
  type ProfessionalTimelineAppointment,
  type ProfessionalTimelinePerson,
} from "./professional-timeline-utils";

const HOUR_HEIGHT = 82;
const TIME_GUTTER = 58;

export function ProfessionalTimeline({
  date,
  now,
  professionals,
  appointments,
  onOpenAppointment,
  onCreateAtSlot,
}: {
  date: Date;
  now: Date;
  professionals: ProfessionalTimelinePerson[];
  appointments: ProfessionalTimelineAppointment[];
  onOpenAppointment: (appointment: ProfessionalTimelineAppointment) => void;
  onCreateAtSlot: (staffId: string, minutes: number, mode: "standard" | "fit") => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const [mobile, setMobile] = useState(false);
  const [mobileProfessionalId, setMobileProfessionalId] = useState(
    professionals[0]?.id ?? "unassigned",
  );
  const [slotMenu, setSlotMenu] = useState<{ staffId: string; minutes: number } | null>(null);
  const bounds = getProfessionalTimelineBounds(appointments);
  const timelineHeight = (bounds.endHour - bounds.startHour) * HOUR_HEIGHT;
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
  const visibleProfessionals = mobile
    ? displayProfessionals.filter((person) => person.id === mobileProfessionalId)
    : displayProfessionals;
  const safeVisibleProfessionals =
    visibleProfessionals.length > 0 ? visibleProfessionals : [displayProfessionals[0]];
  const columnWidth = mobile ? "minmax(0, 1fr)" : "minmax(13rem, 1fr)";
  const gridColumns = `${TIME_GUTTER}px repeat(${safeVisibleProfessionals.length}, ${columnWidth})`;
  const today = sameLocalDay(date, now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const currentTop = ((nowMinutes - bounds.startHour * 60) / 60) * HOUR_HEIGHT;
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
    if (!displayProfessionals.some((person) => person.id === mobileProfessionalId)) {
      setMobileProfessionalId(displayProfessionals[0].id);
    }
  }, [displayProfessionals, mobileProfessionalId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const target = showCurrentTime
        ? currentTop - scrollRef.current.clientHeight * 0.32
        : 0;
      scrollRef.current.scrollTop = Math.max(0, target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentTop, dateKey, showCurrentTime]);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      {mobile && (
        <div className="flex gap-2 overflow-x-auto border-b border-border/70 bg-card px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {displayProfessionals.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => setMobileProfessionalId(person.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-bold transition ${
                person.id === mobileProfessionalId
                  ? "bg-foreground text-background"
                  : "bg-muted/70 text-muted-foreground"
              }`}
            >
              <ProfessionalAvatar person={person} compact />
              <span className="max-w-32 truncate">{person.name}</span>
              <span className="rounded-full bg-background/15 px-1.5 py-0.5 text-[9px] tabular-nums">
                {appointments.filter((appointment) => appointment.staffId === person.id).length}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="max-h-[68dvh] overflow-auto overscroll-contain [scrollbar-width:thin] md:max-h-[72dvh]"
        data-testid="professional-timeline-scroll"
      >
        <div
          className="relative min-w-full"
          style={{
            width: mobile ? "100%" : Math.max(760, TIME_GUTTER + safeVisibleProfessionals.length * 220),
          }}
        >
          <div
            className="sticky top-0 z-40 grid border-b border-border/80 bg-card/95 backdrop-blur-xl"
            style={{ gridTemplateColumns: gridColumns }}
          >
            <div className="sticky left-0 z-50 grid h-14 place-items-center border-r border-border/70 bg-card/95">
              <Clock3 className="h-4 w-4 text-muted-foreground" />
            </div>
            {safeVisibleProfessionals.map((person) => {
              const count = appointments.filter(
                (appointment) => appointment.staffId === person.id,
              ).length;
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
          >
            <div className="sticky left-0 z-30 border-r border-border/70 bg-card">
              {hours.map((hour) => (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] font-bold tabular-nums text-muted-foreground"
                  style={{ top: (hour - bounds.startHour) * HOUR_HEIGHT }}
                >
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>

            {safeVisibleProfessionals.map((person) => {
              const personAppointments = appointments.filter(
                (appointment) => appointment.staffId === person.id,
              );
              const positioned = layoutProfessionalAppointments(
                personAppointments,
                bounds.startHour,
                HOUR_HEIGHT,
              );
              return (
                <div
                  key={person.id}
                  className="relative min-w-0 cursor-crosshair border-r border-border/60 bg-background/20"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const rawMinutes =
                      bounds.startHour * 60 +
                      ((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
                    const minutes = Math.max(
                      bounds.startHour * 60,
                      Math.min(bounds.endHour * 60 - 15, Math.round(rawMinutes / 15) * 15),
                    );
                    setSlotMenu({ staffId: person.id, minutes });
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const rawMinutes = bounds.startHour * 60 + ((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
                    const minutes = Math.max(bounds.startHour * 60, Math.min(bounds.endHour * 60 - 15, Math.round(rawMinutes / 15) * 15));
                    longPressTimerRef.current = window.setTimeout(
                      () => setSlotMenu({ staffId: person.id, minutes }),
                      480,
                    );
                  }}
                  onPointerUp={() => {
                    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }}
                  onPointerCancel={() => {
                    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t border-border/55"
                      style={{ top: (hour - bounds.startHour) * HOUR_HEIGHT }}
                    >
                      <span
                        className="absolute inset-x-0 border-t border-dashed border-border/25"
                        style={{ top: HOUR_HEIGHT / 2 }}
                      />
                    </div>
                  ))}

                  {positioned.map((appointment) => {
                    const left = (appointment.lane / appointment.laneCount) * 100;
                    const width = 100 / appointment.laneCount;
                    return (
                      <button
                        key={appointment.id}
                        type="button"
                        onClick={() => onOpenAppointment(appointment)}
                        className={`absolute z-10 overflow-hidden rounded-xl border border-l-[3px] px-2.5 py-1.5 text-left shadow-sm transition hover:z-20 hover:-translate-y-0.5 hover:shadow-md focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${appointmentTone(appointment.status, appointment.id)}`}
                        style={{
                          top: appointment.top,
                          height: Math.max(16, appointment.height),
                          left: `calc(${left}% + 3px)`,
                          width: `calc(${width}% - 6px)`,
                        }}
                        aria-label={`${formatTime(appointment.startsAt)}, ${appointment.clientName}, ${appointment.serviceName}`}
                      >
                        <span className="flex min-w-0 items-center justify-between gap-1">
                          <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-black tabular-nums">
                            {formatTime(appointment.startsAt)} – {formatTime(appointment.endsAt)}
                          </span>
                          <span className="shrink-0 text-xs font-black leading-none opacity-60" aria-hidden="true">
                            ···
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-xs font-black leading-tight">
                          {appointment.clientName}
                        </span>
                        {appointment.height >= 54 && (
                          <span className="mt-0.5 block truncate text-[10px] font-medium opacity-80">
                            {appointment.serviceName}
                          </span>
                        )}
                        {appointment.height >= 76 && (
                          <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[9px] font-semibold opacity-70">
                            <span className="truncate">{appointment.professionalName} · {appointment.durationLabel}</span>
                            {appointment.valueLabel && <span className="shrink-0 whitespace-nowrap">{appointment.valueLabel}</span>}
                          </span>
                        )}
                        {appointment.height >= 96 && (
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
                className="pointer-events-none absolute left-0 right-0 z-20 border-t border-rose-500/80"
                style={{ top: currentTop }}
                aria-label="Horário atual"
              >
                <span className="sticky left-12 -top-2.5 inline-flex -translate-y-1/2 rounded-full bg-rose-500 px-1.5 py-0.5 font-mono text-[8px] font-black tabular-nums text-white">
                  {formatTime(now.toISOString())}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {slotMenu && (
        <div className="absolute inset-x-3 bottom-3 z-50 rounded-2xl border border-border bg-card p-2 shadow-2xl md:left-auto md:right-4 md:w-72">
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
              label="Novo agendamento"
              onClick={() => {
                onCreateAtSlot(slotMenu.staffId, slotMenu.minutes, "standard");
                setSlotMenu(null);
              }}
            />
            <SlotAction
              icon={<Sparkles className="size-4" />}
              label="Fazer encaixe"
              onClick={() => {
                onCreateAtSlot(slotMenu.staffId, slotMenu.minutes, "fit");
                setSlotMenu(null);
              }}
            />
            <SlotAction
              icon={<LockKeyhole className="size-4" />}
              label="Bloquear horário"
              disabled
              hint="Ainda não disponível"
            />
            <SlotAction
              icon={<Clock3 className="size-4" />}
              label="Intervalo"
              disabled
              hint="Ainda não disponível"
            />
            <SlotAction
              icon={<CalendarPlus className="size-4" />}
              label="Evento interno"
              disabled
              hint="Ainda não disponível"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/70 bg-muted/25 px-3 py-2 text-[9px] font-semibold text-muted-foreground">
        <Legend tone="bg-sky-300" label="Confirmada" />
        <Legend tone="bg-amber-300" label="Pendente" />
        <Legend tone="bg-emerald-300" label="Concluída" />
        <Legend tone="bg-rose-300" label="Cancelada / falta" />
        <span className="ml-auto hidden whitespace-nowrap sm:inline">
          Toque num espaço vazio para criar
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
      {hint && <span className="ml-auto text-[9px] font-semibold text-muted-foreground">{hint}</span>}
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
  const size = compact ? "size-5 text-[8px]" : "size-9 text-[10px]";
  if (person.avatarUrl) {
    return (
      <img
        src={person.avatarUrl}
        alt=""
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

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
