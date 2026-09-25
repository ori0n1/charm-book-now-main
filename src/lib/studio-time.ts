export const DEFAULT_STUDIO_TIME_ZONE = "Europe/Lisbon";

export function normalizeStudioTimeZone(value?: string | null) {
  const candidate = value?.trim() || DEFAULT_STUDIO_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("pt-PT", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_STUDIO_TIME_ZONE;
  }
}

export function getZonedDateParts(value: string | Date, timeZone?: string | null) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeStudioTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

export function getZonedMinutes(value: string | Date, timeZone?: string | null) {
  const parts = getZonedDateParts(value, timeZone);
  return parts.hour * 60 + parts.minute + parts.second / 60;
}

export function formatStudioTime(value: string | Date, timeZone?: string | null) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: normalizeStudioTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatStudioDate(
  value: string | Date,
  timeZone?: string | null,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: normalizeStudioTimeZone(timeZone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...options,
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatStudioTimeRange(
  start: string | Date,
  end: string | Date,
  timeZone?: string | null,
) {
  return `${formatStudioTime(start, timeZone)}–${formatStudioTime(end, timeZone)}`;
}

export function getStudioDateKey(value: string | Date, timeZone?: string | null) {
  const { year, month, day } = getZonedDateParts(value, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatStudioDateTime(value: string | Date, timeZone?: string | null) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: normalizeStudioTimeZone(timeZone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value instanceof Date ? value : new Date(value));
}
