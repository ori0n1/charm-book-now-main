export function normalizeAccountBookingPhone(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[^\d+\s]/g, "")
    .replace(/\s+/g, " ");
}

export function isUsableAccountPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

export function readAccountPreferredPhone(metadata: unknown): string {
  const value = (metadata as Record<string, unknown> | null)?.bellza_booking_phone;
  const phone = typeof value === "string" ? normalizeAccountBookingPhone(value) : "";
  return isUsableAccountPhone(phone) ? phone : "";
}
