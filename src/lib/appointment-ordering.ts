type AppointmentLike = {
  id?: string | null;
  starts_at?: string | null;
  startsAt?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  ends_at?: string | null;
  endsAt?: string | null;
};

type AppointmentOrder = "asc" | "desc";
export type AppointmentChronologyMode = "future" | "history";

function getStartMs(item: AppointmentLike) {
  const value =
    item.starts_at ??
    item.startsAt ??
    (item.appointment_date && item.appointment_time
      ? `${item.appointment_date}T${item.appointment_time}`
      : "");
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getEndMs(item: AppointmentLike) {
  const value = item.ends_at ?? item.endsAt ?? item.starts_at ?? item.startsAt ?? "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : getStartMs(item);
}

export function compareAppointmentsByScheduledTime(
  a: AppointmentLike,
  b: AppointmentLike,
  order: AppointmentOrder = "asc",
) {
  const direction = order === "asc" ? 1 : -1;
  const startDiff = getStartMs(a) - getStartMs(b);
  if (startDiff !== 0) return startDiff * direction;

  const endDiff = getEndMs(a) - getEndMs(b);
  if (endDiff !== 0) return endDiff * direction;

  return 0;
}

export function sortAppointmentsByScheduledTime<T extends AppointmentLike>(
  items: readonly T[],
  order: AppointmentOrder = "asc",
) {
  return [...items].sort((a, b) => compareAppointmentsByScheduledTime(a, b, order));
}

export function sortUpcomingAppointments<T extends AppointmentLike>(items: readonly T[]) {
  return sortAppointmentsByScheduledTime(items, "asc");
}

export function sortPastAppointments<T extends AppointmentLike>(items: readonly T[]) {
  return sortAppointmentsByScheduledTime(items, "desc");
}

export function sortAppointmentsChronologically<T extends AppointmentLike>(
  items: readonly T[],
  mode: AppointmentChronologyMode,
) {
  return mode === "history" ? sortPastAppointments(items) : sortUpcomingAppointments(items);
}
