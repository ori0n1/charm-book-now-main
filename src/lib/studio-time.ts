export const DEFAULT_STUDIO_TIME_ZONE = "Europe/Lisbon";

const normalizedTimeZones = new Map<string, string>();
const datePartsFormatters = new Map<string, Intl.DateTimeFormat>();
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

export function normalizeStudioTimeZone(value?: string | null) {
  const candidate = value?.trim() || DEFAULT_STUDIO_TIME_ZONE;
  const cached = normalizedTimeZones.get(candidate);
  if (cached) return cached;
  try {
    new Intl.DateTimeFormat("pt-PT", { timeZone: candidate }).format(new Date());
    normalizedTimeZones.set(candidate, candidate);
    return candidate;
  } catch {
    normalizedTimeZones.set(candidate, DEFAULT_STUDIO_TIME_ZONE);
    return DEFAULT_STUDIO_TIME_ZONE;
  }
}

export function getZonedDateParts(value: string | Date, timeZone?: string | null) {
  const date = value instanceof Date ? value : new Date(value);
  const zone = normalizeStudioTimeZone(timeZone);
  let formatter = datePartsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    datePartsFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(date);
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
  const zone = normalizeStudioTimeZone(timeZone);
  const date = value instanceof Date ? value : new Date(value);
  let formatter = dateKeyFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateKeyFormatters.set(zone, formatter);
  }
  const formatted = formatter.format(date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  const { year, month, day } = getZonedDateParts(date, zone);
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
