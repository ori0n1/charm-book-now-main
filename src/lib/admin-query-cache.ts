export const ADMIN_REFERENCE_STALE_MS = 60 * 1000;
export const ADMIN_REFERENCE_GC_MS = 10 * 60 * 1000;

export function platformSubscriptionSummaryQueryKey(studioId?: string | null) {
  return ["platform-subscription-summary", studioId ?? null] as const;
}
