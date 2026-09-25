const DAY_MS = 86_400_000;
const ACTIVE_FUTURE_STATUSES = new Set(["confirmed", "pending", "pending_payment"]);

export type ClientRiskAssessment = {
  isAtRisk: boolean;
  averageIntervalDays: number | null;
  daysSinceLastVisit: number | null;
  riskStartedAt: string | null;
};

export function isClientAtRiskByCadence({
  averageIntervalDays,
  daysSinceLastVisit,
  hasFutureBooking,
}: {
  averageIntervalDays: number | null;
  daysSinceLastVisit: number | null;
  hasFutureBooking: boolean;
}) {
  if (hasFutureBooking || averageIntervalDays === null || daysSinceLastVisit === null) return false;
  const safetyDays = Math.max(7, Math.round(averageIntervalDays * 0.35));
  return daysSinceLastVisit > averageIntervalDays + safetyDays;
}

export function isActiveFutureAppointment(status: string, startsAt: string, now = new Date()) {
  const startsAtMs = new Date(startsAt).getTime();
  return (
    ACTIVE_FUTURE_STATUSES.has(status) &&
    Number.isFinite(startsAtMs) &&
    startsAtMs >= now.getTime()
  );
}

export function assessClientRisk({
  completedVisitDates,
  hasFutureBooking,
  now = new Date(),
}: {
  completedVisitDates: string[];
  hasFutureBooking: boolean;
  now?: Date;
}): ClientRiskAssessment {
  const completed = completedVisitDates
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (completed.length === 0) {
    return {
      isAtRisk: false,
      averageIntervalDays: null,
      daysSinceLastVisit: null,
      riskStartedAt: null,
    };
  }

  const lastCompletedAt = completed.at(-1)!;
  const daysSinceLastVisit = Math.max(0, Math.floor((now.getTime() - lastCompletedAt) / DAY_MS));
  if (completed.length < 2) {
    return {
      isAtRisk: false,
      averageIntervalDays: null,
      daysSinceLastVisit,
      riskStartedAt: null,
    };
  }

  const intervals = completed.slice(1).map((value, index) =>
    Math.max(1, Math.round((value - completed[index]) / DAY_MS)),
  );
  const averageIntervalDays = Math.round(
    intervals.reduce((sum, days) => sum + days, 0) / intervals.length,
  );
  const safetyDays = Math.max(7, Math.round(averageIntervalDays * 0.35));
  const riskStartsAfterDays = averageIntervalDays + safetyDays;
  const riskStartedAt = new Date(lastCompletedAt + (riskStartsAfterDays + 1) * DAY_MS).toISOString();

  return {
    isAtRisk: isClientAtRiskByCadence({
      averageIntervalDays,
      daysSinceLastVisit,
      hasFutureBooking,
    }),
    averageIntervalDays,
    daysSinceLastVisit,
    riskStartedAt,
  };
}
