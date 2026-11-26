import test from "node:test";
import assert from "node:assert/strict";
import { manualMessageCounts, matchesManualMessageFilter, recentManualMessageClientIds } from "../src/lib/client-manual-message-filter.ts";

test("o estado recente expira sem apagar o histórico e um novo clique reativa-o", () => {
  const now = Date.parse("2026-11-26T15:00:00Z");
  const records = [
    { client_id: "a", confirmed_at: "2026-11-20T15:00:00Z" },
    { client_id: "b", confirmed_at: "2026-11-26T14:00:00Z" },
    { client_id: "other-studio", confirmed_at: "2026-11-26T14:00:00Z" },
  ];
  assert.deepEqual([...recentManualMessageClientIds(["a", "b"], records, now)], ["b"]);
  records.push({ client_id: "a", confirmed_at: "2026-11-26T14:59:00Z" });
  assert.deepEqual([...recentManualMessageClientIds(["a", "b"], records, now)].sort(), ["a", "b"]);
  assert.equal(records.length, 4);
});

test("cada cliente conta uma vez e confirmações de outro estúdio são ignoradas", () => {
  const result = manualMessageCounts(["a", "b", "c"], ["a", "a", "other-studio"]);
  assert.deepEqual([result.total, result.sent, result.pending], [3, 1, 2]);
  assert.deepEqual([...result.sentClientIds], ["a"]);
});

test("filtros preservam a lista base e mudam sem recarregar dados", () => {
  const { sentClientIds } = manualMessageCounts(["a", "b"], ["a"]);
  assert.deepEqual(
    ["a", "b"].filter((id) => matchesManualMessageFilter(id, "all", sentClientIds)),
    ["a", "b"],
  );
  assert.deepEqual(
    ["a", "b"].filter((id) => matchesManualMessageFilter(id, "sent", sentClientIds)),
    ["a"],
  );
  assert.deepEqual(
    ["a", "b"].filter((id) => matchesManualMessageFilter(id, "pending", sentClientIds)),
    ["b"],
  );
});
