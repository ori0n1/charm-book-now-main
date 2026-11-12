import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { functionalFixture } from "../../agents/functional-fixtures.mjs";
import { inspectFunctionalSnapshot } from "../../agents/sentinela.mjs";
import { runFunctionalCheck } from "../../agents/functional-flow.mjs";

const approved = () => ({
  agent: "valida", status: "APPROVED",
  tests: Array.from({ length: 7 }, () => ({ state: "PASS" })),
});
const failed = () => ({
  agent: "valida", status: "FAILED",
  tests: [{ state: "FAIL" }, ...Array.from({ length: 6 }, () => ({ state: "PASS" }))],
});
async function isolated(run) {
  const path = mkdtempSync(join(tmpdir(), "bellza-functional-"));
  try { return await run(path); }
  finally {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw new Error("UNSAFE_TEST_CLEANUP");
    rmSync(path, { recursive: true, force: true });
  }
}

test("Sentinela aceita apenas agregados sintéticos sem PII", () => {
  const fixture = functionalFixture("issues");
  const anomalies = inspectFunctionalSnapshot(fixture.snapshot);
  assert.equal(anomalies.length, 7);
  assert.deepEqual(new Set(anomalies.map((item) => item.domain)),
    new Set(["agenda", "reservas", "whatsapp", "pagamentos", "clientes"]));
  assert.deepEqual(new Set(anomalies.map((item) => item.studioCode)),
    new Set(["STUDIO_27", "STUDIO_EXEMPLO"]));
  fixture.snapshot.studios[0].clientes.phone = "+351900000000";
  assert.throws(() => inspectFunctionalSnapshot(fixture.snapshot), /FUNCTIONAL_INPUT_UNSAFE/);
});

test("identificadores de estúdio, contagens e campos extra falham fechados", () => {
  const fixture = functionalFixture("baseline");
  fixture.snapshot.studios[0].studioCode = "cliente@example.com";
  assert.throws(() => inspectFunctionalSnapshot(fixture.snapshot), /FUNCTIONAL_INPUT_UNSAFE/);
  const duplicate = functionalFixture("baseline");
  duplicate.snapshot.studios[1].studioCode = "STUDIO_27";
  assert.throws(() => inspectFunctionalSnapshot(duplicate.snapshot), /FUNCTIONAL_INPUT_UNSAFE/);
  const invalid = functionalFixture("baseline");
  invalid.snapshot.studios[0].pagamentos.totalMismatches = -1;
  assert.throws(() => inspectFunctionalSnapshot(invalid.snapshot), /FUNCTIONAL_INPUT_UNSAFE/);
});

test("Atlas regista fluxo dos seis agentes com dependências explícitas", async () => isolated(async (stateDir) => {
  const { report } = await runFunctionalCheck({
    mode: "synthetic", scenario: "issues", stateDir, validate: approved,
  });
  assert.equal(report.steps.length, 5);
  assert.deepEqual(report.steps.map((item) => item.agent),
    ["sentinela", "sherlock", "forge", "valida", "guardiao"]);
  assert.equal(report.steps[1].dependencies[0], report.steps[0].runId);
  assert.equal(report.steps[4].dependencies.length, 4);
  assert.equal(report.publicationAuthorized, false);
  assert.equal(report.remoteWrites, false);
  assert.equal(report.recurringFunctionalMonitoringEnabled, false);
  const history = readFileSync(join(stateDir, "history.jsonl"), "utf8");
  assert.match(history, /"agent":"atlas"/);
}));

test("alertas por estúdio e gravidade são emitidos uma vez e recuperados", async () => isolated(async (stateDir) => {
  const first = await runFunctionalCheck({
    mode: "synthetic", scenario: "issues", stateDir, validate: approved,
  });
  assert.equal(first.report.events.length, 7);
  assert.ok(first.report.events.some((item) =>
    item.studioCode === "STUDIO_27" && item.severity === "critical"));
  const repeated = await runFunctionalCheck({
    mode: "synthetic", scenario: "issues", stateDir, validate: approved,
  });
  assert.equal(repeated.report.events.length, 0);
  const recovered = await runFunctionalCheck({
    mode: "synthetic", scenario: "recovery", stateDir, validate: approved,
  });
  assert.equal(recovered.report.events.length, 7);
  assert.ok(recovered.report.events.every((item) => item.kind === "RECOVERED"));
  const repeatedRecovery = await runFunctionalCheck({
    mode: "synthetic", scenario: "recovery", stateDir, validate: approved,
  });
  assert.equal(repeatedRecovery.report.events.length, 0);
}));

test("Sherlock não comprova causa sem prova e Forge bloqueia proposta", async () => isolated(async (stateDir) => {
  const { report } = await runFunctionalCheck({
    mode: "synthetic", scenario: "issues", stateDir, validate: approved,
  });
  assert.match(report.causeSummary, /NAO_DETERMINADA/);
  assert.match(report.proposalSummary, /nenhuma proposta acionável/);
  assert.equal(report.opinion, "INDETERMINADO");
}));

test("prova sintética gera proposta não aplicada e Guardião não autoriza publicação", async () => isolated(async (stateDir) => {
  const { report } = await runFunctionalCheck({
    mode: "synthetic", scenario: "proof", stateDir, validate: approved,
  });
  assert.match(report.causeSummary, /CONFIRMADA_EM_SIMULACAO/);
  assert.match(report.proposalSummary, /agenda \/ STUDIO_27, não aplicada/);
  assert.equal(report.opinion, "INDETERMINADO");
  assert.equal(report.publicationAuthorized, false);
}));

test("Valida falhada obriga Guardião a bloquear", async () => isolated(async (stateDir) => {
  const { report } = await runFunctionalCheck({
    mode: "synthetic", scenario: "proof", stateDir, validate: failed,
  });
  assert.equal(report.testSummary, "FAILED");
  assert.equal(report.opinion, "BLOQUEADO");
}));

test("modo real não consulta rede nem transforma ausência de dados em recuperação", async () => isolated(async (stateDir) => {
  await runFunctionalCheck({
    mode: "synthetic", scenario: "issues", stateDir, validate: approved,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("UNEXPECTED_NETWORK"); };
  try {
    const { report } = await runFunctionalCheck({
      mode: "live", stateDir, validate: approved,
    });
    assert.equal(report.status, "PENDENTE_ACESSO_FUNCIONAL");
    assert.equal(report.events.length, 0);
    assert.equal(report.activeIssueCount, 7);
    assert.equal(report.integrations.length, 5);
    assert.ok(report.integrations.every((item) =>
      item.status.startsWith("PENDING_")));
  } finally { globalThis.fetch = originalFetch; }
}));

test("lock partilhada do Atlas bloqueia execução concorrente", async () => isolated(async (stateDir) => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const running = runFunctionalCheck({
    mode: "synthetic", scenario: "baseline", stateDir,
    validate: () => pending,
  });
  await assert.rejects(
    runFunctionalCheck({ mode: "synthetic", scenario: "issues",
      stateDir, validate: approved }),
    /CONFLICTING_RUN_ACTIVE/,
  );
  finish(approved());
  const result = await running;
  assert.equal(result.report.status, "SEM_ANOMALIAS_SINTETICAS");
}));

test("relatório e histórico não guardam entrada pessoal nem credenciais", async () => isolated(async (stateDir) => {
  await runFunctionalCheck({
    mode: "synthetic", scenario: "issues", stateDir, validate: approved,
  });
  const report = readFileSync(join(stateDir, "latest-functional.md"), "utf8");
  const state = readFileSync(join(stateDir, "functional-state.json"), "utf8");
  assert.doesNotMatch(report + state, /@|\+351|oauth_token|refresh_token|Bearer /i);
  assert.match(report, /STUDIO_27/);
  assert.match(report, /PENDING_RLS_SCOPED_READ/);
}));
