import { formatStudioDateTime } from "./studio-time";

type BookingManageabilityBooking = {
  startsAt: string | Date;
  endsAt?: string | Date | null;
  createdAt?: string | Date | null;
  status?: string | null;
};

type BookingManageabilityPolicy = {
  cancellationNoticeHours?: number | null;
  rescheduleNoticeHours?: number | null;
  afterDeadlinePolicy?: string | null;
  refundRequestsEnabled?: boolean | null;
  paymentPolicy?: string | null;
  depositPercent?: number | null;
};

export type BookingManageability = {
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
  statusReason: "available" | "created_after_deadline" | "deadline_expired" | "happened" | "cancelled";
  rescheduleStatusReason: "available" | "created_after_deadline" | "deadline_expired" | "happened" | "cancelled";
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
  const cancelled = booking.status === "cancelled";
  const beforeDeadline = nowAt <= deadlineAt;
  const beforeRescheduleDeadline = nowAt <= rescheduleDeadlineAt;
  const createdAfterDeadline = createdAt !== null && createdAt > deadlineAt;
  const createdAfterRescheduleDeadline = createdAt !== null && createdAt > rescheduleDeadlineAt;
  const refundPolicy = studioPolicy.afterDeadlinePolicy ?? "non_refundable";
  const refundable = Boolean(studioPolicy.refundRequestsEnabled) && refundPolicy === "refund_allowed";

  let statusReason: BookingManageability["statusReason"] = "available";
  if (cancelled) statusReason = "cancelled";
  else if (happened) statusReason = "happened";
  else if (createdAfterDeadline) statusReason = "created_after_deadline";
  else if (!beforeDeadline) statusReason = "deadline_expired";

  let rescheduleStatusReason: BookingManageability["rescheduleStatusReason"] = "available";
  if (cancelled) rescheduleStatusReason = "cancelled";
  else if (happened) rescheduleStatusReason = "happened";
  else if (createdAfterRescheduleDeadline) rescheduleStatusReason = "created_after_deadline";
  else if (!beforeRescheduleDeadline) rescheduleStatusReason = "deadline_expired";

  const blockReason = getBlockReason(statusReason);
  const rescheduleBlockReason = getBlockReason(rescheduleStatusReason);
  const canManage = statusReason === "available";
  const canReschedule = rescheduleStatusReason === "available";
  const isFullPay = studioPolicy.paymentPolicy === "pre_payment" && Number(studioPolicy.depositPercent ?? 100) >= 100;
  const refundBlockReason = !refundable
    ? isFullPay
      ? "O pagamento desta marcação não é reembolsável."
      : "O sinal desta marcação não é reembolsável."
    : blockReason;

  return {
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

function getBlockReason(reason: BookingManageability["statusReason"]) {
  if (reason === "cancelled") return "Esta marcação já foi cancelada.";
  if (reason === "happened") return "Esta marcação já aconteceu.";
  if (reason === "created_after_deadline") {
    return "Esta marcação foi criada fora do prazo de cancelamento/remarcação definido pelo estúdio.";
  }
  if (reason === "deadline_expired") return "O prazo de cancelamento/remarcação já passou.";
  return "";
}
