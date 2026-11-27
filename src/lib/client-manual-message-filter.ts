export type MessageFilter = "all" | "sent" | "pending";

// Only the visual state expires. Historical click records stay in the database.
export const MANUAL_MESSAGE_STATUS_HOURS = 72;

export type ManualMessageRecord = { client_id: string; confirmed_at: string };

export function recentManualMessageClientIds(
  clientIds: string[],
  records: ManualMessageRecord[],
  now = Date.now(),
  statusHours = MANUAL_MESSAGE_STATUS_HOURS,
  latestBookingCreatedAtByClient: ReadonlyMap<string, string> = new Map(),
) {
  const clients = new Set(clientIds);
  const cutoff = now - statusHours * 60 * 60 * 1000;
  return new Set(records.filter((record) => {
    const openedAt = Date.parse(record.confirmed_at);
    const latestBookingAt = Date.parse(latestBookingCreatedAtByClient.get(record.client_id) ?? "");
    return clients.has(record.client_id) &&
      Number.isFinite(openedAt) && openedAt >= cutoff && openedAt <= now &&
      (!Number.isFinite(latestBookingAt) || openedAt >= latestBookingAt);
  }).map((record) => record.client_id));
}

export function manualMessageCounts(clientIds: string[], confirmedClientIds: string[]) {
  const clients = new Set(clientIds);
  const sentClientIds = new Set(confirmedClientIds.filter((id) => clients.has(id)));
  return {
    sentClientIds,
    total: clients.size,
    sent: sentClientIds.size,
    pending: clients.size - sentClientIds.size,
  };
}

export function matchesManualMessageFilter(
  clientId: string,
  filter: MessageFilter,
  sentClientIds: ReadonlySet<string>,
) {
  return filter === "all" || (filter === "sent") === sentClientIds.has(clientId);
}
