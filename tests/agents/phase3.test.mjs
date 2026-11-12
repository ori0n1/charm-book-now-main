import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCorrection } from "../../agents/forge.mjs";
import { reviewProposal } from "../../agents/guardiao.mjs";
import { AGENT_REGISTRY, runAtlas } from "../../agents/atlas.mjs";
import { TEST_CASES } from "../../agents/valida.mjs";

const first = "cb586b94-06c9-4165-a97f-1d5fbc5bd49a";
const active = "9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8";
const monitoring = {
  agent: "sentinela", runId: "11111111-1111-4111-8111-111111111111",
  status: "ATENCAO", reference: { officialRecordedVersion: first, observedVersion: active },
};
const diagnosis = {
  agent: "sherlock", runId: "22222222-2222-4222-8222-222222222222",
  status: "DIAGNOSTICADO", source: { runId: monitoring.runId },
  findings: [{ code: "OFFICIAL_RECORD_OUTDATED", causeStatus: "CONFIRMADA" }],
};
const validation = {
  agent: "valida", runId: "33333333-3333-4333-8333-333333333333", status: "APPROVED",
  observedAt: "2026-11-12T15:02:00Z", usage: { testsRun: TEST_CASES.length },
  tests: TEST_CASES.map((item) => ({ file: item.file, state: "PASS" })),
};

function tempState(t) {
  const dir = mkdtempSync(join(tmpdir(), "bellza-phase3-"));
  t.after(() => {
    const actual = realpathSync(dir);
    const allowed = realpathSync(tmpdir());
    assert.ok(actual.startsWith(allowed + (process.platform === "win32" ? "\\" : "/")));
    rmSync(actual, { recursive: true, force: true });
  });
  return dir;
}

test("Forge bloqueia causa indeterminada e não prepara patch", () => {
  const result = planCorrection({ diagnosis: {
    ...diagnosis, findings: [{ ...diagnosis.findings[0], causeStatus: "NAO_DETERMINADA" }],
  }, monitoring });
  assert.equal(result.status, "BLOQUEADO");
  assert.equal(result.proposedPatch, null);
  assert.equal(result.publicationAuthorized, false);
  assert.equal(planCorrection().status, "INDETERMINADO");
});

test("Forge cria só proposta de metadados quando a causa e a versão estão comprovadas", () => {
  const result = planCorrection({ diagnosis, monitoring });
  assert.equal(result.status, "PROPOSTA");
  assert.deepEqual(result.plan.scope, ["agents/reference.json"]);
  assert.deepEqual(result.handoff, ["valida", "guardiao"]);
  assert.equal(result.proposedPatch.applied, false);
  assert.equal(result.proposedPatch.from, first);
  assert.equal(result.proposedPatch.to, active);
  assert.equal(result.publicationAuthorized, false);
  assert.equal(planCorrection({ diagnosis, monitoring: { ...monitoring, runId: "wrong" } }).status, "BLOQUEADO");
});

test("Guardião separa parecer técnico da autorização humana", () => {
  const proposal = { ...planCorrection({ diagnosis, monitoring, now: () => new Date("2026-11-12T15:01:00Z") }),
    runId: "44444444-4444-4444-8444-444444444444" };
  const report = reviewProposal({ proposal, validation, diagnosis, monitoring });
  assert.equal(report.status, "APTO");
  assert.equal(report.publicationAuthorized, false);
  assert.equal(report.deployAllowed, false);
  assert.ok(report.risks.includes("PRODUCTION_PARITY_AND_ROLLBACK_NOT_VERIFIED"));
  assert.equal(reviewProposal({ proposal, validation: { ...validation, status: "FAILED" }, diagnosis, monitoring }).status, "BLOQUEADO");
  assert.equal(reviewProposal({ proposal, validation: { ...validation, status: "INDETERMINATE" }, diagnosis, monitoring }).status, "INDETERMINADO");
  assert.equal(reviewProposal({ proposal, validation: { ...validation, observedAt: "2026-11-12T15:00:00Z" }, diagnosis, monitoring }).status, "INDETERMINADO");
  assert.equal(reviewProposal({ proposal, validation: { ...validation, tests: [] }, diagnosis, monitoring }).status, "INDETERMINADO");
  assert.equal(reviewProposal({ proposal, diagnosis, monitoring }).status, "INDETERMINADO");
});

test("Guardião bloqueia escopo fora da lista e evidência incompatível", () => {
  const proposal = planCorrection({ diagnosis, monitoring, now: () => new Date("2026-11-12T15:01:00Z") });
  const malicious = { ...proposal, plan: { ...proposal.plan, scope: ["src/booking.ts"] },
    proposedPatch: { ...proposal.proposedPatch, file: "src/booking.ts" } };
  const result = reviewProposal({ proposal: malicious, validation, diagnosis, monitoring });
  assert.equal(result.status, "BLOQUEADO");
  assert.ok(result.risks.includes("SCOPE_OR_PERMISSION_RISK"));
  assert.equal(reviewProposal({ proposal: { ...proposal, publicationAuthorized: true },
    validation, diagnosis, monitoring }).status, "BLOQUEADO");
  assert.equal(reviewProposal({ proposal, validation, diagnosis: { ...diagnosis, runId: "wrong" }, monitoring }).status, "BLOQUEADO");
});

test("Atlas executa Forge e Guardião sem evidências, com relatório sanitizado e lock partilhada", async (t) => {
  const stateDir = tempState(t);
  assert.ok(AGENT_REGISTRY.forge.maxDurationMs <= 20_000);
  assert.ok(AGENT_REGISTRY.guardiao.maxDurationMs <= 20_000);
  const forge = await runAtlas({ agent: "forge", stateDir });
  assert.equal(forge.status, "INDETERMINADO");
  assert.equal(forge.report.proposedPatch, null);
  const guard = await runAtlas({ agent: "guardiao", stateDir });
  assert.equal(guard.status, "INDETERMINADO");
  assert.equal(guard.report.deployAllowed, false);
  assert.doesNotMatch(readFileSync(guard.reportPath, "utf8"), /SECRET_SHOULD_NOT_APPEAR/);
  const pending = runAtlas({ agent: "forge", stateDir,
    childArgs: ["-e", "setTimeout(() => process.stdout.write('{}'), 300)"],
  });
  for (let i = 0; i < 50 && !existsSync(join(stateDir, "atlas.lock")); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await assert.rejects(() => runAtlas({ agent: "guardiao", stateDir }), { code: "CONFLICTING_RUN_ACTIVE" });
  await pending;
});

test("Atlas descarta campos sensíveis fornecidos pelo processo Forge", async (t) => {
  const stateDir = tempState(t);
  const payload = { agent: "forge", observedAt: "2026-11-12T15:00:00Z", status: "INDETERMINADO",
    recommendations: ["SECRET_SHOULD_NOT_APPEAR"], proposedPatch: { file: "src/booking.ts" } };
  const result = await runAtlas({ agent: "forge", stateDir,
    childArgs: ["-e", `process.stdout.write(JSON.stringify(${JSON.stringify(payload)}))`],
  });
  assert.equal(result.status, "INDETERMINADO");
  assert.doesNotMatch(JSON.stringify(result.report), /SECRET_SHOULD_NOT_APPEAR|src\/booking\.ts/);
  assert.doesNotMatch(readFileSync(result.reportPath, "utf8"), /SECRET_SHOULD_NOT_APPEAR/);
});
