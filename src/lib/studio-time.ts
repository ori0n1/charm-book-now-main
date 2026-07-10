export const DEFAULT_STUDIO_TIME_ZONE = "Europe/Lisbon";

export function normalizeStudioTimeZone(timeZone?: string | null) {
  const value = String(timeZone || "").trim() || DEFAULT_STUDIO_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("pt-PT", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return DEFAULT_STUDIO_TIME_ZONE;
  }
}

export function formatStudioDate(
  value: string | number | Date,
  timeZone?: string | null,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: normalizeStudioTimeZone(timeZone),
    day: "2-digit",
    month: "long",
    ...options,
  }).format(new Date(value));
}

export function formatStudioTime(
  value: string | number | Date,
  timeZone?: string | null,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: normalizeStudioTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(new Date(value));
}

export function formatStudioDateTime(value: string | number | Date, timeZone?: string | null) {
  return `${formatStudioDate(value, timeZone)} as ${formatStudioTime(value, timeZone)}`;
}

export function formatStudioTimeRange(
  start: string | number | Date,
  end: string | number | Date,
  timeZone?: string | null,
) {
  return `${formatStudioTime(start, timeZone)} - ${formatStudioTime(end, timeZone)}`;
}

export function getStudioDateKey(value: string | number | Date, timeZone?: string | null) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeStudioTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
