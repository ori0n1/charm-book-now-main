import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { requireSharedMonitorStateDir } from "../../agents/monitor-shared-state.mjs";

const valid = resolve("C:/Bellza/existing/.bellza-agent-state");

test("Sentinela reutiliza o diretório de histórico configurado", () => {
  assert.equal(requireSharedMonitorStateDir({ monitorStateDir: valid }), valid);
});

test("Sentinela não cria histórico paralelo quando configuração falta", () => {
  for (const config of [null, {}, { monitorStateDir: "relative" },
    { monitorStateDir: resolve("C:/Bellza/new-state") }]) {
    assert.throws(() => requireSharedMonitorStateDir(config),
      /MONITOR_STATE_CONFIG_INVALID/);
  }
});
