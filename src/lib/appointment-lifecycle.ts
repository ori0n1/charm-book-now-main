export const DEFAULT_APPOINTMENT_REMINDER_MINUTES = 120;
export const DEFAULT_ATTENDANCE_GRACE_MINUTES = 30;

export type AppointmentLifecycleStage =
  | "scheduled"
  | "awaiting_service"
  | "awaiting_confirmation"
  | "completed"
  | "no_show"
  | "cancelled"
  | "pending_payment"
  | "pending";

export type AppointmentLifecycleInput = {
  status: string | null | undefined;
  startsAt: string | Date;
  now?: string | Date;
  graceMinutes?: number | null;
};

function timestamp(value: string | Date) {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : Number.NaN;
}

export function normalizeLifecycleMinutes(
  value: number | null | undefined,
  fallback: number,
  minimum = 0,
  maximum = 7 * 24 * 60,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

export function getAppointmentLifecycleStage({
  status,
  startsAt,
  now = new Date(),
  graceMinutes,
}: AppointmentLifecycleInput): AppointmentLifecycleStage {
  const normalizedStatus = String(status ?? "pending").toLowerCase();
  if (normalizedStatus === "completed") return "completed";
  if (normalizedStatus === "no_show") return "no_show";
  if (normalizedStatus === "cancelled" || normalizedStatus === "canceled") return "cancelled";
  if (normalizedStatus === "pending_payment") return "pending_payment";
  if (normalizedStatus !== "confirmed") return "pending";

  const startsAtMs = timestamp(startsAt);
  const nowMs = timestamp(now);
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(nowMs)) return "scheduled";
  if (nowMs < startsAtMs) return "scheduled";

  const grace = normalizeLifecycleMinutes(
    graceMinutes,
    DEFAULT_ATTENDANCE_GRACE_MINUTES,
    0,
    24 * 60,
  );
  return nowMs < startsAtMs + grace * 60_000
    ? "awaiting_service"
    : "awaiting_confirmation";
}

export function lifecycleStageLabel(stage: AppointmentLifecycleStage) {
  const labels: Record<AppointmentLifecycleStage, string> = {
    scheduled: "Confirmada",
    awaiting_service: "Aguardando atendimento",
    awaiting_confirmation: "Aguardando confirmação",
    completed: "Compareceu",
    no_show: "Faltou",
    cancelled: "Cancelada",
    pending_payment: "Pagamento pendente",
    pending: "Pendente",
  };
  return labels[stage];
}

export function isAttendanceResolutionPending(input: AppointmentLifecycleInput) {
  return getAppointmentLifecycleStage(input) === "awaiting_confirmation";
}

export function appointmentLifecycleEventKey(
  appointmentId: string,
  startsAt: string | Date,
  event: "reminder" | "attendance_confirmation",
) {
  const startsAtMs = timestamp(startsAt);
  const anchor = Number.isFinite(startsAtMs) ? Math.floor(startsAtMs / 1000) : "invalid";
  return `appointment:${appointmentId}:${event}:${anchor}`;
}

export function shouldSendAppointmentReminder(input: {
  status: string | null | undefined;
  startsAt: string | Date;
  now?: string | Date;
  reminderMinutes?: number | null;
}) {
  if (String(input.status ?? "").toLowerCase() !== "confirmed") return false;
  const startsAtMs = timestamp(input.startsAt);
  const nowMs = timestamp(input.now ?? new Date());
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(nowMs) || nowMs >= startsAtMs) return false;
  const reminderMinutes = normalizeLifecycleMinutes(
    input.reminderMinutes,
    DEFAULT_APPOINTMENT_REMINDER_MINUTES,
    0,
  );
  return nowMs >= startsAtMs - reminderMinutes * 60_000;
}

/** Final guard for a reminder that may have waited in a delivery queue. */
export function isAppointmentReminderDispatchable(input: {
  status: string | null | undefined;
  startsAt: string | Date;
  queuedStartsAt?: string | Date | null;
  now?: string | Date;
}) {
  if (String(input.status ?? "").toLowerCase() !== "confirmed") return false;
  const startsAtMs = timestamp(input.startsAt);
  const nowMs = timestamp(input.now ?? new Date());
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(nowMs) || nowMs >= startsAtMs) {
    return false;
  }
  if (input.queuedStartsAt != null) {
    const queuedStartsAtMs = timestamp(input.queuedStartsAt);
    if (!Number.isFinite(queuedStartsAtMs) || queuedStartsAtMs !== startsAtMs) return false;
  }
  return true;
}
