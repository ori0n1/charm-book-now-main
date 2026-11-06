export type MessageFilter = "all" | "sent" | "pending";

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
