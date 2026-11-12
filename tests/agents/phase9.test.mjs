import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import {
  assessAgendaReservationReadProof,
  collectAgendaReservationAggregates,
  inspectLocalAgendaReservationAccess,
} from "../../agents/agenda-reservas-source.mjs";
import { functionalFixture } from "../../agents/functional-fixtures.mjs";
import { runFunctionalCheck } from "../../agents/functional-flow.mjs";

const safeProof = () => ({
  projectRef: "pwmdzpvnatrvfpgcvnzg",
  roleName: "bellza_agent_reader",
  canLogin: true, superuser: false, bypassRls: false,
  canWrite: false, securityDefinerWrite: false,
  rlsEffective: true, studioIsolationVerified: true,
  transactionReadOnly: true, roleMemberships: 0,
});
const approved = () => ({
  agent: "valida", status: "APPROVED",
  tests: Array.from({ length: 7 }, () => ({ state: "PASS" })),
});
const rows = () => functionalFixture("agenda-reservas").snapshot.studios
  .map(({ studioCode, agenda, reservas }) => ({ studioCode, agenda, reservas }));
const source = (proof = safeProof(), results = rows()) => ({
  kind: "TRUSTED_RLS_AGGREGATE_READER",
  openReadOnlySession: async () => ({
    verifyRole: async () => proof,
    readAggregates: async () => results,
    close: async () => {},
  }),
});
const studioCodes = ["STUDIO_27", "STUDIO_EXEMPLO"];
async function isolated(run) {
  const path = mkdtempSync(join(tmpdir(), "bellza-functional-rls-"));
  try { return await run(path); }
  finally {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw new Error("UNSAFE_TEST_CLEANUP");
    rmSync(path, { recursive: true, force: true });
  }
}

test("pré-requisitos locais apenas indicam bloqueio sem abrir ficheiros", () => {
  const base = "C:/ficticio/Local";
  assert.equal(inspectLocalAgendaReservationAccess({
    localAppData: base, exists: () => false,
  }).status, "BLOCKED_LOCAL_READ_CONFIG_MISSING");
  assert.equal(inspectLocalAgendaReservationAccess({
    localAppData: base, exists: (path) => path.endsWith("sql-catalog.json"),
  }).status, "BLOCKED_CA_MISSING");
  assert.equal(inspectLocalAgendaReservationAccess({
    localAppData: base, exists: (path) => !path.endsWith("vault-unlock.clixml"),
  }).status, "BLOCKED_VAULT_ACCESS_MISSING");
  assert.equal(inspectLocalAgendaReservationAccess({
    localAppData: base, exists: () => true,
  }).status, "BLOCKED_EFFECTIVE_ROLE_UNVERIFIED");
});

test("role NOLOGIN, BYPASSRLS, escrita e ausência de isolamento são rejeitados", async () => {
  for (const change of [
    { canLogin: false }, { superuser: true }, { bypassRls: true },
    { canWrite: true }, { securityDefinerWrite: true },
    { rlsEffective: false }, { studioIsolationVerified: false },
    { transactionReadOnly: false }, { roleMemberships: 1 },
    { projectRef: "qflwsdrgdkkcxjnbxmis" }, { roleName: "service_role" },
  ]) {
    const proof = { ...safeProof(), ...change };
    assert.equal(assessAgendaReservationReadProof(proof).status,
      "BLOCKED_READ_PROOF_UNSAFE");
    let reads = 0;
    let closes = 0;
    await assert.rejects(collectAgendaReservationAggregates({
      source: { kind: "TRUSTED_RLS_AGGREGATE_READER",
        openReadOnlySession: async () => ({
          verifyRole: async () => proof,
          readAggregates: async () => { reads++; return rows(); },
          close: async () => { closes++; },
        }) },
      studioCodes,
    }), /FUNCTIONAL_ACCESS_BLOCKED/);
    assert.equal(reads, 0);
    assert.equal(closes, 1);
  }
});

test("agregados por estúdio validam conjunto exato, sem dados pessoais", async () => {
  const snapshot = await collectAgendaReservationAggregates({
    source: source(), studioCodes,
  });
  assert.equal(snapshot.source, "RLS_AGGREGATE_READ");
  assert.equal(snapshot.studios.length, 2);
  assert.equal(snapshot.studios[0].agenda.queryErrors, 1);
  assert.equal(snapshot.studios[1].reservas.processingFailures, 0);
  await assert.rejects(collectAgendaReservationAggregates({
    source: source(safeProof(), [{ ...rows()[0], studioCode: "STUDIO_OUTRO" }, rows()[1]]),
    studioCodes,
  }), /FUNCTIONAL_STUDIO_ISOLATION_FAILED/);
  await assert.rejects(collectAgendaReservationAggregates({
    source: source(safeProof(), [{ ...rows()[0], email: "cliente@example.com" }, rows()[1]]),
    studioCodes,
  }), /FUNCTIONAL_STUDIO_ISOLATION_FAILED/);
});

test("fixture agenda/reservas expõe cinco erros só no Studio 27", async () => isolated(async (stateDir) => {
  const { report } = await runFunctionalCheck({
    mode: "synthetic", scenario: "agenda-reservas", stateDir, validate: approved,
  });
  assert.equal(report.anomalies.length, 5);
  assert.ok(report.anomalies.every((item) => item.studioCode === "STUDIO_27"));
  assert.deepEqual(report.studioSummary.map((item) => item.issueCount), [5, 0]);
  assert.match(report.causeSummary, /NAO_DETERMINADA/);
  assert.match(report.proposalSummary, /nenhuma proposta acionável/);
}));

test("fonte agregada simulada percorre seis agentes sem atribuir causa real", async () => isolated(async (stateDir) => {
  const { report } = await runFunctionalCheck({
    mode: "adapter-test", source: source(), studioCodes, stateDir,
    validate: approved,
  });
  assert.equal(report.integrationState, "SIMULACAO");
  assert.equal(report.mode, "ADAPTER_SIMULATION");
  assert.equal(report.anomalies.length, 5);
  assert.equal(report.steps.length, 5);
  assert.match(report.causeSummary, /NAO_DETERMINADA/);
  assert.match(report.proposalSummary, /nenhuma proposta acionável/);
  assert.equal(report.opinion, "INDETERMINADO");
  const text = readFileSync(join(stateDir, "latest-functional.md"), "utf8");
  assert.doesNotMatch(text, /cliente@example.com|oauth_token|Bearer /i);
  assert.match(text, /STUDIO_27: 5 anomalia/);
}));

test("sem fonte autorizada não há consulta nem relatório de produção saudável", async () => isolated(async (stateDir) => {
  await assert.rejects(runFunctionalCheck({
    mode: "adapter-test", stateDir, studioCodes, validate: approved,
  }), /FUNCTIONAL_ACCESS_BLOCKED/);
  const { report } = await runFunctionalCheck({
    mode: "live", stateDir, validate: approved,
    accessCheck: () => ({ status: "BLOCKED_LOCAL_READ_CONFIG_MISSING" }),
  });
  assert.equal(report.integrationState, "BLOQUEADA");
  assert.equal(report.accessStatus, "BLOCKED_LOCAL_READ_CONFIG_MISSING");
  assert.equal(report.anomalies.length, 0);
  assert.equal(report.events.length, 0);
  assert.equal(report.publicationAuthorized, false);
}));
