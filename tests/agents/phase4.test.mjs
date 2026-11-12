import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAtlas, runIntegratedCheck } from "../../agents/atlas.mjs";
import { diagnoseSentinela } from "../../agents/sherlock.mjs";

function tempState(t) {
  const dir = mkdtempSync(join(tmpdir(), "bellza-integrated-"));
  t.after(() => {
    const actual = realpathSync(dir);
    const allowed = realpathSync(tmpdir());
    assert.ok(actual.startsWith(allowed + (process.platform === "win32" ? "\\" : "/")));
    rmSync(actual, { recursive: true, force: true });
  });
  return dir;
}

test("fluxo sintético completo vincula cinco etapas e não aplica proposta", async (t) => {
  const stateDir = tempState(t);
  const reference = fileURLToPath(new URL("../../agents/reference.json", import.meta.url));
  const before = readFileSync(reference, "utf8");
  const result = await runIntegratedCheck({ mode: "synthetic", stateDir });
  assert.equal(result.status, "APTO");
  assert.equal(result.report.mode, "SYNTHETIC_SIMULATION");
  assert.deepEqual(result.report.steps.map((step) => step.agent),
    ["sentinela", "sherlock", "forge", "valida", "guardiao"]);
  const [sentinela, sherlock, forge, valida, guardiao] = result.report.steps;
  assert.deepEqual(sherlock.dependencies, [sentinela.runId]);
  assert.deepEqual(forge.dependencies, [sherlock.runId, sentinela.runId]);
  assert.deepEqual(valida.dependencies, [forge.runId]);
  assert.deepEqual(guardiao.dependencies, [forge.runId, valida.runId, sherlock.runId, sentinela.runId]);
  assert.deepEqual(result.report.anomaly, ["OFFICIAL_RECORD_OUTDATED"]);
  assert.deepEqual(result.report.cause, [{ code: "OFFICIAL_RECORD_OUTDATED", status: "CONFIRMADA" }]);
  assert.equal(result.report.proposal?.applied, false);
  assert.equal(result.report.proposal?.file, "agents/reference.json");
  assert.equal(result.report.tests, "APPROVED");
  assert.equal(result.report.opinion, "APTO");
  assert.equal(result.report.publicationAuthorized, false);
  assert.equal(result.report.deployAllowed, false);
  assert.equal(readFileSync(reference, "utf8"), before);
  const markdown = readFileSync(result.reportPath, "utf8");
  assert.match(markdown, /SIMULAÇÃO LOCAL/);
  assert.match(markdown, /não aplicada/);
  assert.doesNotMatch(markdown, /SUPABASE_SERVICE_ROLE_KEY|STRIPE_LIVE_API_KEY/);
  assert.ok(existsSync(join(stateDir, "flows", `${result.id}.json`)));
});

test("causa desconhecida não reutiliza proposta de fluxo anterior", async (t) => {
  const stateDir = tempState(t);
  const first = await runIntegratedCheck({ mode: "synthetic", stateDir });
  const second = await runIntegratedCheck({ mode: "synthetic", scenario: "unknown-cause", stateDir });
  assert.notEqual(first.id, second.id);
  assert.equal(second.report.cause[0].status, "NAO_DETERMINADA");
  assert.equal(second.report.proposal, null);
  assert.equal(second.report.steps[2].status, "BLOQUEADO");
  assert.equal(second.report.opinion, "BLOQUEADO");
  assert.ok(second.report.steps.every((step) =>
    !first.report.steps.some((old) => old.runId === step.runId || step.dependencies.includes(old.runId))));
});

test("falha de testes bloqueia parecer e autenticação ausente permanece indeterminada", async (t) => {
  const stateDir = tempState(t);
  const failed = await runIntegratedCheck({ mode: "synthetic", scenario: "test-failure", stateDir });
  assert.equal(failed.report.proposal?.applied, false);
  assert.equal(failed.report.tests, "FAILED");
  assert.equal(failed.report.opinion, "BLOQUEADO");
  const auth = await runIntegratedCheck({ mode: "synthetic", scenario: "auth-unavailable", stateDir });
  assert.ok(auth.report.anomaly.includes("AUTH_UNAVAILABLE"));
  assert.equal(auth.report.steps[0].status, "INDETERMINADO");
  assert.equal(auth.report.proposal, null);
  assert.equal(auth.report.opinion, "INDETERMINADO");
});

test("prova sintética nunca confirma um relatório sem marca e vínculo explícitos", () => {
  const sourceReport = {
    agent: "sentinela", runId: "11111111-1111-4111-8111-111111111111",
    observedAt: "2026-11-12T00:00:00Z", status: "ATENCAO",
    reference: { officialRecordedVersion: "11111111-1111-4111-8111-111111111111",
      observedVersion: "22222222-2222-4222-8222-222222222222" },
    anomalies: [{ code: "OFFICIAL_RECORD_OUTDATED", severity: "warning" }],
    checks: [{ name: "cloudflare_traffic", status: "PASS",
      version: "22222222-2222-4222-8222-222222222222" }],
  };
  const syntheticProof = { kind: "SYNTHETIC_OFFICIAL_RECORD_PROOF", sourceRunId: sourceReport.runId,
    ...sourceReport.reference };
  assert.equal(diagnoseSentinela({ sourceReport, syntheticProof }).findings[0].causeStatus,
    "NAO_DETERMINADA");
  assert.equal(diagnoseSentinela({ sourceReport: { ...sourceReport, syntheticScenario: true },
    syntheticProof: { ...syntheticProof, sourceRunId: "wrong" } }).findings[0].causeStatus,
  "NAO_DETERMINADA");
});

test("Atlas bloqueia execução concorrente até o fluxo terminar", async (t) => {
  const stateDir = tempState(t);
  const pending = runIntegratedCheck({ mode: "synthetic", stateDir });
  assert.ok(existsSync(join(stateDir, "atlas.lock")));
  await assert.rejects(() => runIntegratedCheck({ mode: "synthetic", stateDir }),
    { code: "CONFLICTING_RUN_ACTIVE" });
  await assert.rejects(() => runAtlas({ agent: "forge", stateDir }),
    { code: "CONFLICTING_RUN_ACTIVE" });
  const result = await pending;
  assert.equal(result.status, "APTO");
  assert.equal(existsSync(join(stateDir, "atlas.lock")), false);
});
