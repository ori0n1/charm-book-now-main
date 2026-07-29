export type AgendaTimelineState = "past" | "current" | "future";

export type AgendaListAppointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
};

export type AgendaDayGroup<T extends AgendaListAppointment> = {
  key: string;
  date: Date;
  title: string;
  appointments: T[];
  isToday: boolean;
  isTomorrow: boolean;
  isPast: boolean;
};

const TERMINAL_APPOINTMENT_STATUSES = new Set(["cancelled", "completed", "no_show"]);

export function buildAgendaDayGroups<T extends AgendaListAppointment>(
  appointments: T[],
  now = new Date(),
): AgendaDayGroup<T>[] {
  const today = startOfLocalDay(now);
  const tomorrow = addLocalDays(today, 1);
  const grouped = new Map<string, { date: Date; appointments: T[] }>();

  for (const appointment of appointments) {
    const startsAt = new Date(appointment.starts_at);
    if (Number.isNaN(startsAt.getTime())) continue;
    const date = startOfLocalDay(startsAt);
    const key = localDateKey(date);
    const existing = grouped.get(key);
    if (existing) existing.appointments.push(appointment);
    else grouped.set(key, { date, appointments: [appointment] });
  }

  const groups = Array.from(grouped.entries()).map(([key, group]) => ({
    key,
    date: group.date,
    title: formatAgendaDayTitle(group.date, now),
    appointments: [...group.appointments].sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    ),
    isToday: group.date.getTime() === today.getTime(),
    isTomorrow: group.date.getTime() === tomorrow.getTime(),
    isPast: group.date.getTime() < today.getTime(),
  }));

  const currentAndUpcoming = groups
    .filter((group) => !group.isPast)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const history = groups
    .filter((group) => group.isPast)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return [...currentAndUpcoming, ...history];
}

export function findNextOperationalAppointmentId<T extends AgendaListAppointment>(
  appointments: T[],
  now = new Date(),
) {
  const nowMs = now.getTime();
  return (
    [...appointments]
      .filter(
        (appointment) =>
          !TERMINAL_APPOINTMENT_STATUSES.has(appointment.status) &&
          new Date(appointment.ends_at).getTime() > nowMs,
      )
      .sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      )[0]?.id ?? null
  );
}

export function getAgendaTimelineState(
  appointment: Pick<AgendaListAppointment, "starts_at" | "ends_at">,
  now = new Date(),
): AgendaTimelineState {
  const nowMs = now.getTime();
  const startsAt = new Date(appointment.starts_at).getTime();
  const endsAt = new Date(appointment.ends_at).getTime();
  if (endsAt <= nowMs) return "past";
  if (startsAt <= nowMs && endsAt > nowMs) return "current";
  return "future";
}

export function formatAgendaDayTitle(date: Date, now = new Date()) {
  const day = startOfLocalDay(date);
  const today = startOfLocalDay(now);
  const tomorrow = addLocalDays(today, 1);
  const includeYear = day.getFullYear() !== today.getFullYear();
  const formatted = capitalizeFirst(
    new Intl.DateTimeFormat("pt-PT", {
      weekday: "long",
      day: "numeric",
      month: "long",
      ...(includeYear ? { year: "numeric" as const } : {}),
    }).format(day),
  );

  if (day.getTime() === today.getTime()) return `Hoje • ${formatted}`;
  if (day.getTime() === tomorrow.getTime()) return `Amanhã • ${formatted}`;
  return formatted;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, amount: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function capitalizeFirst(value: string) {
  return value ? value.charAt(0).toLocaleUpperCase("pt-PT") + value.slice(1) : value;
}
