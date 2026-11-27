const REMINDER_WINDOW_MS = 2 * 60 * 60 * 1000;

export function isManualReminderOpen(startsAt: string, openedAt?: string): boolean {
  if (!openedAt) return false;
  const start = Date.parse(startsAt);
  const opened = Date.parse(openedAt);
  return Number.isFinite(start) && Number.isFinite(opened) &&
    opened >= start - REMINDER_WINDOW_MS && opened < start;
}

export function isManualReminderPending(startsAt: string, now: Date, openedAt?: string): boolean {
  const start = Date.parse(startsAt);
  const remaining = start - now.getTime();
  return Number.isFinite(remaining) && remaining > 0 && remaining <= REMINDER_WINDOW_MS &&
    !isManualReminderOpen(startsAt, openedAt);
}
