import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseSentinela } from "../../agents/sherlock.mjs";
import {
  TEST_CASES,
  runApprovedTest,
  runValida,
  syntheticEnvironment,
} from "../../agents/valida.mjs";
import { runAtlas } from "../../agents/atlas.mjs";

const sentinelaReport = {
  agent: "sentinela",
  observedAt: "2026-11-12T13:00:00Z",
  status: "ATENCAO",
  reference: {
    observedVersion: "9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8",
    officialRecordedVersion: "cb586b94-06c9-4165-a97f-1d5fbc5bd49a",
  },
  checks: [
    { name: "cloudflare_traffic", status: "PASS", version: "9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8", percentage: 100 },
    { name: "public_endpoint", path: "/login", status: "FAILED", httpStatus: 503 },
  ],
  anomalies: [
    { code: "OFFICIAL_RECORD_OUTDATED", severity: "warning", detail: "SECRET_SHOULD_NOT_APPEAR" },
    { code: "PUBLIC_ENDPOINT_UNAVAILABLE", severity: "warning", detail: "SECRET_SHOULD_NOT_APPEAR" },
  ],
  recommendations: ["SECRET_SHOULD_NOT_APPEAR"],
  usage: { cloudflare: 2, public: 1 },
};

function tempState(t) {
  const dir = mkdtempSync(join(tmpdir(), "bellza-phase2-"));
  t.after(() => {
    const actual = realpathSync(dir);
    const allowed = realpathSync(tmpdir());
    assert.ok(actual.startsWith(allowed + (process.platform === "win32" ? "\\" : "/")));
    rmSync(actual, { recursive: true, force: true });
  });
  return dir;
}

test("Sherlock distingue evidência, hipótese e causa desconhecida", () => {
  const report = diagnoseSentinela({
    sourceReport: { ...sentinelaReport, runId: "11111111-1111-4111-8111-111111111111" },
    recentEvents: [
      { id: "00000000-0000-4000-8000-000000000001", agent: "sentinela", state: "COMPLETED",
        anomalyCodes: ["PUBLIC_ENDPOINT_UNAVAILABLE"] },
    ],
    now: () => new Date("2026-11-12T13:01:00Z"),
  });
  assert.equal(report.status, "DIAGNOSTICADO");
  const endpoint = report.findings.find((item) => item.code === "PUBLIC_ENDPOINT_UNAVAILABLE");
  assert.equal(endpoint.causeStatus, "NAO_DETERMINADA");
  assert.equal(endpoint.hypothesis, null);
  assert.equal(endpoint.priorOccurrences, 1);
  assert.deepEqual(endpoint.evidence, [{ name: "public_endpoint", status: "FAILED", path: "/login", httpStatus: 503 }]);
  assert.doesNotMatch(JSON.stringify(report), /SECRET_SHOULD_NOT_APPEAR/);
});

test("Sherlock não inventa diagnóstico sem relatório ou regra conhecida", () => {
  assert.equal(diagnoseSentinela().status, "INDETERMINADO");
  const report = diagnoseSentinela({
    sourceReport: { ...sentinelaReport, anomalies: [{ code: "FUTURE_UNKNOWN", severity: "warning" }] },
  });
  assert.equal(report.findings[0].code, "UNCLASSIFIED_ANOMALY");
  assert.equal(report.findings[0].hypothesis, null);
  assert.deepEqual(report.findings[0].affected, ["nao-determinado"]);
});

test("Valida distingue aprovado, falha e indeterminado por área", () => {
  const approved = runValida({
    runCase: (item) => ({ file: item.file, state: "PASS", reason: null, durationMs: 1 }),
  });
  assert.equal(approved.status, "APPROVED");
  assert.deepEqual(approved.areas.map((item) => item.name),
    ["agenda", "clientes", "reservas", "notificacoes", "pagamentos"]);
  const failed = runValida({
    runCase: (item) => ({ file: item.file,
      state: item.file === "tests/client-duplicates.test.mjs" ? "FAIL" : "PASS",
      reason: item.file === "tests/client-duplicates.test.mjs" ? "SYNTHETIC_TEST_FAILED" : null,
      durationMs: 1 }),
  });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.areas.find((item) => item.name === "clientes").status, "FAILED");
  const unavailable = runValida({
    runCase: (item) => ({ file: item.file, state: "INDETERMINATE", reason: "DEPENDENCY_UNAVAILABLE", durationMs: 0 }),
  });
  assert.equal(unavailable.status, "INDETERMINATE");
});

test("Valida usa só ficheiros aprovados e remove credenciais do ambiente", () => {
  const result = runApprovedTest({ file: "tests/qa-agenda-payment-smoke.mjs" });
  assert.equal(result.reason, "TEST_NOT_ALLOWLISTED");
  assert.equal(TEST_CASES.length, 7);
  const env = syntheticEnvironment({
    PATH: "safe", SUPABASE_SERVICE_ROLE_KEY: "SECRET_SHOULD_NOT_APPEAR",
    STRIPE_LIVE_API_KEY: "SECRET_SHOULD_NOT_APPEAR",
    APPDATA: "SECRET_SHOULD_NOT_APPEAR",
    NODE_OPTIONS: "--import unsafe",
  });
  assert.equal(env.PATH, "safe");
  assert.equal(env.BELLZA_SYNTHETIC_ONLY, "true");
  assert.doesNotMatch(JSON.stringify(env), /SECRET_SHOULD_NOT_APPEAR/);
});

test("guard de testes bloqueia rede local sintética", () => {
  const guard = fileURLToPath(new URL("../../agents/local-test-guard.cjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--require", guard, "-e",
    "try { require('node:net').connect(1, '127.0.0.1') } catch (error) { process.stdout.write(error.message) }"], {
    encoding: "utf8", timeout: 5000, env: syntheticEnvironment(),
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "BELLZA_TEST_NETWORK_DENIED");
  const esm = spawnSync(process.execPath, ["--require", guard, "--input-type=module", "-e",
    "import { connect } from 'node:net'; try { connect(1, '127.0.0.1') } catch (error) { process.stdout.write(error.message) }"], {
    encoding: "utf8", timeout: 5000, env: syntheticEnvironment(),
  });
  assert.equal(esm.status, 0);
  assert.equal(esm.stdout, "BELLZA_TEST_NETWORK_DENIED");
});

test("Atlas integra Sherlock ao último relatório Sentinela e bloqueia conflito com Valida", async (t) => {
  const stateDir = tempState(t);
  const source = await runAtlas({
    stateDir,
    childArgs: ["-e", `process.stdout.write(JSON.stringify(${JSON.stringify(sentinelaReport)}))`],
  });
  assert.equal(source.status, "ATENCAO");
  const diagnosed = await runAtlas({ agent: "sherlock", stateDir });
  assert.equal(diagnosed.status, "DIAGNOSTICADO");
  assert.equal(diagnosed.report.source.runId, source.id);
  const saved = readFileSync(diagnosed.reportPath, "utf8");
  assert.match(saved, /PUBLIC_ENDPOINT_UNAVAILABLE/);
  assert.doesNotMatch(saved, /SECRET_SHOULD_NOT_APPEAR/);

  const pending = runAtlas({
    agent: "sherlock", stateDir,
    childArgs: ["-e", "setTimeout(() => process.stdout.write('{}'), 300)"],
  });
  for (let index = 0; index < 50 && !existsSync(join(stateDir, "atlas.lock")); index++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  await assert.rejects(() => runAtlas({ agent: "valida", stateDir }), { code: "CONFLICTING_RUN_ACTIVE" });
  await pending;
});
