export type MessageFilter = "all" | "sent" | "pending";

// Only the visual state expires. Historical click records stay in the database.
export const MANUAL_MESSAGE_STATUS_HOURS = 72;

export type ManualMessageRecord = { client_id: string; confirmed_at: string };

export function recentManualMessageClientIds(
  clientIds: string[],
  records: ManualMessageRecord[],
  now = Date.now(),
  statusHours = MANUAL_MESSAGE_STATUS_HOURS,
) {
  const clients = new Set(clientIds);
  const cutoff = now - statusHours * 60 * 60 * 1000;
  return new Set(records.filter((record) =>
    clients.has(record.client_id) &&
    Number.isFinite(Date.parse(record.confirmed_at)) &&
    Date.parse(record.confirmed_at) >= cutoff &&
    Date.parse(record.confirmed_at) <= now,
  ).map((record) => record.client_id));
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
