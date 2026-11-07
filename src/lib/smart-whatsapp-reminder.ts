const MINUTE = 60_000;

export type ReminderWindow = 1440 | 120 | 30;

export type SmartReminderSchedule = {
  windowMinutes: ReminderWindow;
  dueAt: number;
};

export function smartReminderTemplateId(
  messageKind: string | undefined,
  legacyReminder: boolean | undefined,
  configuredId: string,
) {
  return messageKind === "reminder_2h" && !legacyReminder ? configuredId : "";
}

/** Preserve the production key across the old and new reminder dispatchers. */
export function whatsappReminderIdempotencyKey(appointmentId: string, startsAt: string | Date) {
  return `arara-reminder-2h-${appointmentId}-${new Date(startsAt).getTime()}`;
}

/** The confirmation (or reschedule) instant selects one reminder window. */
export function getSmartReminderSchedule(
  confirmedAt: string | Date,
  startsAt: string | Date,
): SmartReminderSchedule | null {
  const confirmed = new Date(confirmedAt).getTime();
  const starts = new Date(startsAt).getTime();
  if (!Number.isFinite(confirmed) || !Number.isFinite(starts)) return null;

  const lead = starts - confirmed;
  const windowMinutes: ReminderWindow | 0 = lead > 1440 * MINUTE
    ? 1440
    : lead > 120 * MINUTE
      ? 120
      : lead > 30 * MINUTE
        ? 30
        : 0;
  if (!windowMinutes) return null;
  return { windowMinutes, dueAt: starts - windowMinutes * MINUTE };
}

export function isSmartReminderDue(input: {
  status: string;
  confirmedAt: string | Date;
  startsAt: string | Date;
  now: string | Date;
  maxLateMinutes?: number;
}) {
  if (input.status !== "confirmed") return false;
  const schedule = getSmartReminderSchedule(input.confirmedAt, input.startsAt);
  if (!schedule) return false;
  const now = new Date(input.now).getTime();
  const starts = new Date(input.startsAt).getTime();
  const confirmed = new Date(input.confirmedAt).getTime();
  const maxLate = (input.maxLateMinutes ?? 2) * MINUTE;
  return Number.isFinite(now) && now >= schedule.dueAt &&
    now < starts && now > confirmed && now - schedule.dueAt <= maxLate;
}
