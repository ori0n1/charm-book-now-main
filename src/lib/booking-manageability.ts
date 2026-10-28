import { formatStudioDateTime } from "./studio-time";

type BookingManageabilityBooking = {
  startsAt: string | Date;
  endsAt?: string | Date | null;
  createdAt?: string | Date | null;
  status?: string | null;
};

type BookingManageabilityPolicy = {
  cancellationEnabled?: boolean | null;
  rescheduleEnabled?: boolean | null;
  cancellationNoticeHours?: number | null;
  rescheduleNoticeHours?: number | null;
  afterDeadlinePolicy?: string | null;
  refundRequestsEnabled?: boolean | null;
  paymentPolicy?: string | null;
  depositPercent?: number | null;
};

export type StudioBookingAction = "cancellation" | "reschedule";

export function getStudioBookingActionSetting(
  settings: unknown,
  action: StudioBookingAction,
) {
  if (!settings || typeof settings !== "object") {
    return { enabled: true, noticeHours: null as number | null };
  }
  const raw = (settings as Record<string, unknown>)[action];
  if (!raw || typeof raw !== "object") {
    return { enabled: true, noticeHours: null as number | null };
  }
  const value = raw as { active?: unknown; notice_hours?: unknown };
  const noticeHours = Number(value.notice_hours);
  return {
    enabled: value.active !== false,
    noticeHours: Number.isFinite(noticeHours) && noticeHours >= 0 ? noticeHours : null,
  };
}

export type BookingManageability = {
  cancellationEnabled: boolean;
  rescheduleEnabled: boolean;
  noticeHours: number;
  rescheduleNoticeHours: number;
  deadlineAt: string;
  rescheduleDeadlineAt: string;
  createdAt: string | null;
  nowAt: string;
  beforeDeadline: boolean;
  beforeRescheduleDeadline: boolean;
  createdAfterDeadline: boolean;
  createdAfterRescheduleDeadline: boolean;
  happened: boolean;
  cancelled: boolean;
  refundable: boolean;
  canCancel: boolean;
  canReschedule: boolean;
  canRequestRefund: boolean;
  statusReason:
    | "available"
    | "disabled_by_studio"
    | "status_not_manageable"
    | "created_after_deadline"
    | "deadline_expired"
    | "happened"
    | "cancelled";
  rescheduleStatusReason:
    | "available"
    | "disabled_by_studio"
    | "status_not_manageable"
    | "created_after_deadline"
    | "deadline_expired"
    | "happened"
    | "cancelled";
  manageabilityText: string;
  rescheduleManageabilityText: string;
  deadlineText: string;
  rescheduleDeadlineText: string;
  blockReason: string;
  rescheduleBlockReason: string;
  refundBlockReason: string;
  refundPolicy: string;
};

export function getBookingManageability(
  booking: BookingManageabilityBooking,
  studioPolicy: BookingManageabilityPolicy,
  studioTimezone?: string | null,
  now: string | Date = new Date(),
): BookingManageability {
  const startsAt = parseInstant(booking.startsAt);
  const endsAt = parseInstant(booking.endsAt ?? booking.startsAt);
  const createdAt = parseInstant(booking.createdAt ?? null);
  const nowAt = parseInstant(now);
  const cancellationEnabled = studioPolicy.cancellationEnabled !== false;
  const rescheduleEnabled = studioPolicy.rescheduleEnabled !== false;
  const noticeHours = normalizeNoticeHours(studioPolicy.cancellationNoticeHours);
  const rescheduleNoticeHours = normalizeNoticeHours(studioPolicy.rescheduleNoticeHours ?? noticeHours);
  const deadlineAt = startsAt - noticeHours * 60 * 60 * 1000;
  const rescheduleDeadlineAt = startsAt - rescheduleNoticeHours * 60 * 60 * 1000;
  const deadlineIso = new Date(deadlineAt).toISOString();
  const rescheduleDeadlineIso = new Date(rescheduleDeadlineAt).toISOString();
  const createdIso = createdAt ? new Date(createdAt).toISOString() : null;
  const deadlineLabel = formatStudioDateTime(deadlineIso, studioTimezone).replace(" as ", " às ");
  const rescheduleDeadlineLabel = formatStudioDateTime(rescheduleDeadlineIso, studioTimezone).replace(" as ", " às ");
  const deadlineText = `Pode cancelar até ${deadlineLabel}.`;
  const rescheduleDeadlineText = `Pode remarcar até ${rescheduleDeadlineLabel}.`;

  const happened = endsAt <= nowAt;
  const normalizedStatus = String(booking.status ?? "").toLowerCase();
  const cancelled = normalizedStatus === "cancelled";
  const statusNotManageable = ["completed", "no_show", "rescheduled"].includes(normalizedStatus);
  const beforeDeadline = nowAt <= deadlineAt;
  const beforeRescheduleDeadline = nowAt <= rescheduleDeadlineAt;
  const createdAfterDeadline = createdAt !== null && createdAt > deadlineAt;
  const createdAfterRescheduleDeadline = createdAt !== null && createdAt > rescheduleDeadlineAt;
  const refundPolicy = studioPolicy.afterDeadlinePolicy ?? "non_refundable";
  const refundable = Boolean(studioPolicy.refundRequestsEnabled) && refundPolicy === "refund_allowed";

  let statusReason: BookingManageability["statusReason"] = "available";
  if (cancelled) statusReason = "cancelled";
  else if (happened) statusReason = "happened";
  else if (statusNotManageable) statusReason = "status_not_manageable";
  else if (!cancellationEnabled) statusReason = "disabled_by_studio";
  else if (createdAfterDeadline) statusReason = "created_after_deadline";
  else if (!beforeDeadline) statusReason = "deadline_expired";

  let rescheduleStatusReason: BookingManageability["rescheduleStatusReason"] = "available";
  if (cancelled) rescheduleStatusReason = "cancelled";
  else if (happened) rescheduleStatusReason = "happened";
  else if (statusNotManageable) rescheduleStatusReason = "status_not_manageable";
  else if (!rescheduleEnabled) rescheduleStatusReason = "disabled_by_studio";
  else if (createdAfterRescheduleDeadline) rescheduleStatusReason = "created_after_deadline";
  else if (!beforeRescheduleDeadline) rescheduleStatusReason = "deadline_expired";

  const blockReason = getBlockReason(statusReason, "cancel");
  const rescheduleBlockReason = getBlockReason(rescheduleStatusReason, "reschedule");
  const canManage = statusReason === "available";
  const canReschedule = rescheduleStatusReason === "available";
  const isFullPay = studioPolicy.paymentPolicy === "pre_payment" && Number(studioPolicy.depositPercent ?? 100) >= 100;
  const refundBlockReason = !refundable
    ? isFullPay
      ? "O pagamento desta marcação não é reembolsável."
      : "O sinal desta marcação não é reembolsável."
    : blockReason;

  return {
    cancellationEnabled,
    rescheduleEnabled,
    noticeHours,
    rescheduleNoticeHours,
    deadlineAt: deadlineIso,
    rescheduleDeadlineAt: rescheduleDeadlineIso,
    createdAt: createdIso,
    nowAt: new Date(nowAt).toISOString(),
    beforeDeadline,
    beforeRescheduleDeadline,
    createdAfterDeadline,
    createdAfterRescheduleDeadline,
    happened,
    cancelled,
    refundable,
    canCancel: canManage,
    canReschedule,
    canRequestRefund: canManage && refundable,
    statusReason,
    rescheduleStatusReason,
    manageabilityText: canManage ? deadlineText : blockReason,
    rescheduleManageabilityText: canReschedule ? rescheduleDeadlineText : rescheduleBlockReason,
    deadlineText,
    rescheduleDeadlineText,
    blockReason,
    rescheduleBlockReason,
    refundBlockReason,
    refundPolicy,
  };
}

function parseInstant(value: string | Date | null): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) return 0;
  return time;
}

function normalizeNoticeHours(value: number | null | undefined) {
  const hours = Number(value ?? 24);
  return Number.isFinite(hours) && hours >= 0 ? hours : 24;
}

function getBlockReason(
  reason: BookingManageability["statusReason"],
  action: "cancel" | "reschedule",
) {
  if (reason === "cancelled") return "Esta marcação já foi cancelada.";
  if (reason === "happened") return "Esta marcação já aconteceu.";
  if (reason === "status_not_manageable") {
    return "O estado atual desta reserva não permite alterações.";
  }
  if (reason === "disabled_by_studio") {
    return action === "cancel"
      ? "O estúdio não permite cancelamentos online."
      : "O estúdio não permite remarcações online.";
  }
  if (reason === "created_after_deadline") {
    return "Esta marcação foi criada fora do prazo de cancelamento/remarcação definido pelo estúdio.";
  }
  if (reason === "deadline_expired") return "O prazo de cancelamento/remarcação já passou.";
  return "";
}
