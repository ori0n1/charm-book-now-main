import { z } from "zod";

const appointmentStartSchema = z
  .string()
  .trim()
  .min(1)
  .datetime({ offset: true })
  .transform((value, context) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid_appointment_start",
      });
      return z.NEVER;
    }
    return parsed.toISOString();
  });

/**
 * Accepts an ISO 8601 instant returned by PostgREST (`Z` or an explicit offset)
 * and serializes it to the canonical UTC representation expected by TIMESTAMPTZ.
 * Local datetimes without an offset are intentionally rejected because their
 * meaning changes with the browser/server timezone.
 */
export function normalizeAppointmentStart(value: unknown) {
  return appointmentStartSchema.parse(value);
}

