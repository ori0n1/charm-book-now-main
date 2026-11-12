import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runMonitorOnce } from "../../agents/monitor.mjs";
import { syntheticMonitorReport } from "../../agents/monitor-fixtures.mjs";
import { runPublicCheck } from "../../agents/public-flow.mjs";

const tempState = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "bellza-integrated-"));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("um único ciclo Atlas executa Cloudflare e todas as páginas sintéticas", async () => tempState(async (stateDir) => {
  const first = await runMonitorOnce({ mode: "synthetic", includePublic: true,
    stateDir });
  const second = await runMonitorOnce({ mode: "synthetic", includePublic: true,
    stateDir });
  assert.equal(first.publicStatus, "PAGINAS_E_RECURSOS_OK");
  assert.equal(first.publicCheckedPages, 17);
  assert.equal(first.publicExpectedPages, 17);
  assert.equal(first.status, "ATENCAO");
  assert.equal(first.overallStatus, "ATENCAO");
  assert.deepEqual(first.knownPending, ["OFFICIAL_RECORD_OUTDATED"]);
  assert.equal(first.events.length, 0);
  assert.equal(second.events.length, 0);
  assert.notEqual(first.monitorId, second.monitorId);
  assert.notEqual(first.publicRunId, second.publicRunId);
  const state = JSON.parse(readFileSync(join(stateDir, "monitor-state.json"), "utf8"));
  assert.equal(state.journal.length, 2);
  assert.equal(state.journal[1].publicRunId, second.publicRunId);
  assert.match(readFileSync(second.reportPath, "utf8"), /17\/17/);
}));

test("falha pública não interrompe Cloudflare nem grava erro sensível", async () => tempState(async (stateDir) => {
  const result = await runMonitorOnce({ mode: "synthetic", includePublic: true,
    stateDir, publicCheck: async () => { throw new Error("FAKE_SECRET_MUST_NOT_APPEAR"); } });
  assert.equal(result.status, "ATENCAO");
  assert.equal(result.publicStatus, "INDETERMINADO");
  assert.equal(result.publicFailureCode, "PUBLIC_CHECK_FAILED");
  assert.equal(result.overallStatus, "INDETERMINADO");
  assert.equal(existsSync(join(stateDir, "monitor-state.json")), true);
  assert.doesNotMatch(readFileSync(result.reportPath, "utf8"), /FAKE_SECRET/);
}));

test("anomalia pública gera um alerta e uma recuperação, sem repetição", async () => tempState(async (stateDir) => {
  const options = { mode: "synthetic", includePublic: true, stateDir };
  const first = await runMonitorOnce({ ...options, publicScenario: "studio-failure" });
  const repeat = await runMonitorOnce({ ...options, publicScenario: "studio-failure" });
  const recovery = await runMonitorOnce({ ...options, publicScenario: "healthy" });
  assert.deepEqual(first.events.filter((item) => item.path === "/s/studio27braga")
    .map((item) => item.kind), ["NEW"]);
  assert.equal(repeat.events.length, 0);
  assert.deepEqual(recovery.events.filter((item) => item.path === "/s/studio27braga")
    .map((item) => item.kind), ["RECOVERED"]);
  assert.equal(first.status, "ATENCAO");
  assert.equal(first.overallStatus, "ALERTA");
}));

test("a mesma falha em /login gera um só alerta consolidado", async () => tempState(async (stateDir) => {
  const id = randomUUID();
  const source = syntheticMonitorReport("outage", { runId: id });
  const publicCheck = async () => ({ id: randomUUID(), reportPath: "synthetic",
    report: { status: "ANOMALIAS", checkedPages: 1, expectedPages: 1,
      discoveryStatus: "OK", anomalies: [{ path: "/login", severity: "critical" }],
      events: [{ kind: "NEW", path: "/login", code: "PUBLIC_PAGE_HTTP_ERROR",
        severity: "critical" }] } });
  const result = await runMonitorOnce({ mode: "synthetic", includePublic: true,
    stateDir, collect: async () => ({ id, report: source }), publicCheck });
  assert.equal(result.events.filter((item) =>
    item.evidence?.path === "/login" || item.path === "/login").length, 1);
}));

test("monitor.lock impede outro ciclo enquanto o público está em execução", async () => tempState(async (stateDir) => {
  let releasePublic;
  const pending = runMonitorOnce({ mode: "synthetic", includePublic: true,
    stateDir, publicCheck: () => new Promise((resolve) => { releasePublic = resolve; }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(existsSync(join(stateDir, "monitor.lock")), true);
  await assert.rejects(() => runMonitorOnce({ mode: "synthetic", stateDir }),
    { message: "MONITOR_CONFLICTING_RUN" });
  releasePublic({ id: randomUUID(), reportPath: "synthetic", report: {
    status: "PAGINAS_E_RECURSOS_OK", checkedPages: 1, expectedPages: 1,
    discoveryStatus: "OK", anomalies: [], events: [] } });
  await pending;
  assert.equal(existsSync(join(stateDir, "monitor.lock")), false);
}));

test("retenção pública remove somente relatórios antigos identificados", async () => tempState(async (stateDir) => {
  const oldId = randomUUID();
  const history = [oldId, ...Array.from({ length: 239 }, () => randomUUID())]
    .map((flowId) => ({ flowId }));
  writeFileSync(join(stateDir, "public-state.json"), JSON.stringify({
    schema: 1, issues: [], history, alerts: [],
  }));
  const reportsDir = join(stateDir, "public-runs");
  mkdirSync(reportsDir);
  writeFileSync(join(reportsDir, `${oldId}.json`), JSON.stringify({
    flowId: oldId, mode: "SYNTHETIC_SIMULATION",
  }));
  writeFileSync(join(reportsDir, `${oldId}.md`), "synthetic");
  const result = await runPublicCheck({ mode: "synthetic", stateDir,
    validate: () => ({ agent: "valida", status: "APPROVED",
      tests: Array.from({ length: 7 }, () => ({ state: "PASS" })) }) });
  assert.equal(result.report.checkedPages, 17);
  assert.equal(existsSync(join(reportsDir, `${oldId}.json`)), false);
  assert.equal(existsSync(join(reportsDir, `${oldId}.md`)), false);
  assert.equal(JSON.parse(readFileSync(join(stateDir, "public-state.json"), "utf8"))
    .history.length, 240);
}));
