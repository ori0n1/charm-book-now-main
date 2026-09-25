export const PUBLIC_BOOKING_RATE_LIMITS = {
  ip: { limit: 15, windowMs: 15 * 60_000 },
  phone: { limit: 10, windowMs: 30 * 60_000 },
  slot: { limit: 4, windowMs: 5 * 60_000 },
  studio: { limit: 60, windowMs: 5 * 60_000 },
} as const;
