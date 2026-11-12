import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { inspectReadOnlyOAuth, verifyNoninteractiveReadOnlyOAuth } from "../../agents/monitor-auth.mjs";
import { MONITOR_CONFIG, runMonitorOnce } from "../../agents/monitor.mjs";
import { syntheticMonitorReport } from "../../agents/monitor-fixtures.mjs";

const config = (scopes, expiration = "2026-11-12T17:00:00Z") => [
  'oauth_token = "FAKE_TOKEN_MUST_NOT_APPEAR"',
  'refresh_token = "FAKE_REFRESH_MUST_NOT_APPEAR"',
  `expiration_time = "${expiration}"`,
  `scopes = [ ${scopes.map((item) => `"${item}"`).join(", ")} ]`,
].join("\n");
const READ = ["account:read", "user:read", "workers_tail:read", "offline_access"];

function tempState(t) {
  const dir = mkdtempSync(join(tmpdir(), "bellza-monitor-"));
  t.after(() => {
    const actual = realpathSync(dir);
    const allowed = realpathSync(tmpdir());
    assert.ok(actual.startsWith(allowed + (process.platform === "win32" ? "\\" : "/")));
    rmSync(actual, { recursive: true, force: true });
  });
  return dir;
}

test("OAuth não interativo exige escopos estritamente de leitura e não expõe credenciais", () => {
  const inspect = (contents) => inspectReadOnlyOAuth({ appData: "synthetic",
    readFile: () => contents });
  assert.equal(inspect(config(READ)).status, "READ_ONLY_SCOPES");
  assert.equal(inspect(config([...READ, "workers_scripts:write"])).status, "AUTH_SCOPE_UNSAFE");
  assert.equal(inspect(config(["account:read", "user:read"])).status, "AUTH_SCOPE_UNSAFE");
  assert.equal(inspect("missing").status, "AUTH_SCOPE_UNSAFE");
  let probed = false;
  const blocked = verifyNoninteractiveReadOnlyOAuth({
    inspect: () => inspect(config([...READ, "workers:write"])),
    whoami: () => { probed = true; return true; },
  });
  assert.equal(blocked.status, "AUTH_SCOPE_UNSAFE");
  assert.equal(probed, false);
  let current = config(READ, "2026-11-12T14:00:00Z");
  const refreshed = verifyNoninteractiveReadOnlyOAuth({
    inspect: () => inspect(current),
    whoami: () => { current = config(READ); return true; },
    now: () => new Date("2026-11-12T15:00:00Z"),
  });
  assert.equal(refreshed.status, "READY");
  assert.doesNotMatch(JSON.stringify(refreshed), /FAKE_TOKEN|FAKE_REFRESH/);
});

test("verificações periódicas simuladas preservam IDs e suprimem pendência conhecida", async (t) => {
  const stateDir = tempState(t);
  const first = await runMonitorOnce({ mode: "synthetic", stateDir });
  const second = await runMonitorOnce({ mode: "synthetic", stateDir });
  assert.equal(first.events.length, 0);
  assert.equal(second.events.length, 0);
  assert.notEqual(first.monitorId, second.monitorId);
  assert.notEqual(first.sentinelaRunId, second.sentinelaRunId);
  assert.deepEqual(second.knownPending, ["OFFICIAL_RECORD_OUTDATED"]);
  const state = JSON.parse(readFileSync(join(stateDir, "monitor-state.json"), "utf8"));
  assert.equal(state.journal.length, 2);
  assert.equal(state.alerts.length, 0);
  assert.equal(state.journal[1].sentinelaRunId, second.sentinelaRunId);
  assert.match(readFileSync(second.reportPath, "utf8"), /SYNTHETIC_SIMULATION/);
});

test("alteração da versão e falha pública alertam uma vez e recuperação é registada", async (t) => {
  const stateDir = tempState(t);
  await runMonitorOnce({ mode: "synthetic", stateDir });
  const changed = await runMonitorOnce({ mode: "synthetic", scenario: "version-change", stateDir });
  assert.deepEqual(changed.events.map((item) => `${item.kind}:${item.code}`),
    ["NEW:REFERENCE_OUTDATED"]);
  const repeated = await runMonitorOnce({ mode: "synthetic", scenario: "version-change", stateDir });
  assert.equal(repeated.events.length, 0);
  const outage = await runMonitorOnce({ mode: "synthetic", scenario: "outage", stateDir });
  assert.ok(outage.events.some((item) => item.kind === "NEW" &&
    item.key === "PUBLIC_ENDPOINT_UNAVAILABLE:/login"));
  const duplicate = await runMonitorOnce({ mode: "synthetic", scenario: "outage", stateDir });
  assert.equal(duplicate.events.length, 0);
  const recovered = await runMonitorOnce({ mode: "synthetic", scenario: "recovery", stateDir });
  assert.ok(recovered.events.some((item) => item.kind === "RECOVERED" &&
    item.key === "PUBLIC_ENDPOINT_UNAVAILABLE:/login"));
  assert.equal(recovered.events.some((item) => item.code === "OFFICIAL_RECORD_OUTDATED"), false);
});

test("mudanças de bindings, runtime e crons são alertadas sem duplicação", async (t) => {
  const stateDir = tempState(t);
  await runMonitorOnce({ mode: "synthetic", stateDir });
  const changed = await runMonitorOnce({ mode: "synthetic", scenario: "metadata-change", stateDir });
  assert.equal(changed.status, "ALERTA");
  assert.deepEqual(changed.events.map((item) => item.code).sort(), [
    "BINDINGS_DIVERGENCE_CONFIRMED", "CRONS_DIVERGENCE_CONFIRMED",
    "RUNTIME_DIVERGENCE_CONFIRMED",
  ]);
  assert.deepEqual(changed.events.find((item) => item.code === "BINDINGS_DIVERGENCE_CONFIRMED").evidence,
    { missing: ["APP_URL:plain_text"], unexpected: ["APP_URL:secret_text"] });
  const repeated = await runMonitorOnce({ mode: "synthetic", scenario: "metadata-change", stateDir });
  assert.equal(repeated.events.length, 0);
  const recovered = await runMonitorOnce({ mode: "synthetic", scenario: "recovery", stateDir });
  assert.equal(recovered.events.filter((item) => item.kind === "RECOVERED").length, 3);
});

test("falha OAuth não recupera falsamente problemas Cloudflare e recuperação alerta uma vez", async (t) => {
  const stateDir = tempState(t);
  await runMonitorOnce({ mode: "synthetic", scenario: "version-change", stateDir });
  const blocked = await runMonitorOnce({ mode: "synthetic", scenario: "auth-unavailable", stateDir });
  assert.ok(blocked.events.some((item) => item.code === "AUTH_UNAVAILABLE" && item.kind === "NEW"));
  assert.equal(blocked.events.some((item) => item.code === "REFERENCE_OUTDATED" && item.kind === "RECOVERED"), false);
  const duplicate = await runMonitorOnce({ mode: "synthetic", scenario: "auth-unavailable", stateDir });
  assert.equal(duplicate.events.length, 0);
  const recovery = await runMonitorOnce({ mode: "synthetic", scenario: "recovery", stateDir });
  assert.ok(recovery.events.some((item) => item.code === "AUTH_UNAVAILABLE" && item.kind === "RECOVERED"));
});

test("escopo OAuth inseguro bloqueia rede e grava só código sanitizado", async (t) => {
  const stateDir = tempState(t);
  let collected = false;
  const result = await runMonitorOnce({ stateDir,
    authCheck: () => ({ status: "AUTH_SCOPE_UNSAFE" }),
    collect: async () => { collected = true; throw new Error("MUST_NOT_RUN"); },
  });
  assert.equal(collected, false);
  assert.equal(result.status, "INDETERMINADO");
  assert.equal(result.events[0].code, "AUTH_SCOPE_UNSAFE");
  assert.doesNotMatch(readFileSync(result.reportPath, "utf8"), /MUST_NOT_RUN/);
});

test("execuções simultâneas são bloqueadas até terminar estado e relatório", async (t) => {
  const stateDir = tempState(t);
  let finish;
  const pending = runMonitorOnce({ mode: "synthetic", stateDir,
    collect: () => new Promise((resolve) => { finish = resolve; }),
  });
  assert.ok(existsSync(join(stateDir, "monitor.lock")));
  await assert.rejects(() => runMonitorOnce({ mode: "synthetic", stateDir }),
    { message: "MONITOR_CONFLICTING_RUN" });
  const id = randomUUID();
  finish({ id, report: syntheticMonitorReport("baseline", { runId: id }) });
  await pending;
  assert.equal(existsSync(join(stateDir, "monitor.lock")), false);
});

test("texto sensível da fonte não entra nos relatórios ou histórico", async (t) => {
  const stateDir = tempState(t);
  const id = randomUUID();
  const source = syntheticMonitorReport("outage", { runId: id });
  source.anomalies[0].detail = "PERSONAL_DATA_MUST_NOT_APPEAR";
  source.leak = "PERSONAL_DATA_MUST_NOT_APPEAR";
  const result = await runMonitorOnce({ mode: "synthetic", stateDir,
    collect: async () => ({ id, report: source }) });
  const saved = readFileSync(result.reportPath, "utf8") +
    readFileSync(join(stateDir, "monitor-state.json"), "utf8");
  assert.doesNotMatch(saved, /PERSONAL_DATA_MUST_NOT_APPEAR/);
});

test("histórico do monitor respeita retenção e agendamento permanece desativado", async (t) => {
  assert.equal(MONITOR_CONFIG.plannedIntervalMinutes, 30);
  assert.equal(MONITOR_CONFIG.scheduleEnabled, false);
  assert.equal(MONITOR_CONFIG.externalNotifications, false);
  const stateDir = tempState(t);
  const old = { monitorId: randomUUID(), sentinelaRunId: randomUUID(),
    at: "2026-01-01T00:00:00Z", mode: "SYNTHETIC_SIMULATION", status: "OK",
    issueKeys: [], eventCodes: [] };
  writeFileSync(join(stateDir, "monitor-state.json"), JSON.stringify({ schema: 1, last: null,
    journal: Array.from({ length: MONITOR_CONFIG.maxJournalEntries }, () => old), alerts: [] }));
  const result = await runMonitorOnce({ mode: "synthetic", stateDir });
  const saved = JSON.parse(readFileSync(join(stateDir, "monitor-state.json"), "utf8"));
  assert.equal(saved.journal.length, MONITOR_CONFIG.maxJournalEntries);
  assert.equal(saved.journal.at(-1).monitorId, result.monitorId);
});

test("retenção remove só relatório antigo da Sentinela identificado e deixa outros agentes", async (t) => {
  const stateDir = tempState(t);
  const oldId = randomUUID();
  const keptId = randomUUID();
  const oldEntry = { monitorId: randomUUID(), sentinelaRunId: oldId,
    at: "2026-01-01T00:00:00Z", mode: "LIVE_READ_ONLY", status: "OK",
    issueKeys: [], eventCodes: [] };
  const keptEntry = { ...oldEntry, monitorId: randomUUID(), sentinelaRunId: keptId };
  writeFileSync(join(stateDir, "monitor-state.json"), JSON.stringify({ schema: 1, last: null,
    journal: [oldEntry, ...Array.from({ length: MONITOR_CONFIG.maxJournalEntries - 1 }, () => keptEntry)],
    alerts: [] }));
  mkdirSync(join(stateDir, "runs"));
  const oldFile = join(stateDir, "runs", `${oldId}.json`);
  const keptFile = join(stateDir, "runs", `${keptId}.json`);
  writeFileSync(oldFile, JSON.stringify({ agent: "sentinela", runId: oldId }));
  writeFileSync(keptFile, JSON.stringify({ agent: "sherlock", runId: keptId }));
  const result = await runMonitorOnce({ mode: "synthetic", stateDir });
  assert.equal(result.retentionSkipped, 0);
  assert.equal(existsSync(oldFile), false);
  assert.equal(existsSync(keptFile), true);
});
