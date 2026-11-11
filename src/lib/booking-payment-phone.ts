export function comparableBookingPaymentPhone(value: string): string {
  // The account marker is an identity key, not a phone number.
  if (value.startsWith("account:")) return value;
  const digits = value.replace(/\D/g, "");
  if (/^9\d{8}$/.test(digits)) return `351${digits}`;
  if (/^003519\d{8}$/.test(digits)) return digits.slice(2);
  return digits;
}
