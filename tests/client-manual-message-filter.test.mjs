import test from "node:test";
import assert from "node:assert/strict";
import { manualMessageCounts, matchesManualMessageFilter } from "../src/lib/client-manual-message-filter.ts";

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
