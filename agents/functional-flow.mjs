import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_STATE_DIR, acquireAtlasLock, appendAtlasEvent } from "./atlas.mjs";
import { FUNCTIONAL_INTEGRATIONS } from "./functional-contract.mjs";
import { functionalFixture } from "./functional-fixtures.mjs";
import { inspectFunctionalSnapshot } from "./sentinela.mjs";
import { diagnoseFunctional } from "./sherlock.mjs";
import { planFunctionalCorrection } from "./forge.mjs";
import { runValida } from "./valida.mjs";
import { reviewFunctional } from "./guardiao.mjs";

const RETENTION = 1440;
// At most 10 studios x 13 metrics may be present in either snapshot.
// Keep enough space for simultaneous recoveries and new issues.
const MAX_EVENTS = 260;
const runId = () => randomUUID();
const issueKey = (item) => `${item.studioCode}:${item.code}`;

function readState(stateDir) {
  const path = join(stateDir, "functional-state.json");
  if (!existsSync(path)) return { schema: 1, last: null, journal: [], alerts: [] };
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("FUNCTIONAL_STATE_INVALID"); }
  if (state?.schema !== 1 || !Array.isArray(state.journal) ||
      !Array.isArray(state.alerts) || state.journal.length > RETENTION ||
      state.alerts.length > RETENTION || (state.last !== null &&
      (!state.last || !Array.isArray(state.last.issues)))) {
    throw new Error("FUNCTIONAL_STATE_INVALID");
  }
  return state;
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.functional-${runId()}.tmp`);
  writeFileSync(temporary, value, { mode: 0o600 });
  renameSync(temporary, path);
}

function compareIssues(previous, current) {
  // No live functional adapter is enabled. Missing coverage cannot prove a
  // recovery, so a pending run leaves the previous observation untouched.
  if (current === null) return { issues: previous?.issues ?? [], events: [] };
  const old = new Map((previous?.issues ?? []).map((item) => [issueKey(item), item]));
  const incoming = new Map(current.map((item) => [issueKey(item), item]));
  const events = [];
  for (const item of incoming.values()) {
    if (!old.has(issueKey(item))) {
      events.push({ kind: "NEW", studioCode: item.studioCode,
        domain: item.domain, code: item.code, severity: item.severity,
        evidence: item.evidence });
    }
  }
  for (const item of old.values()) {
    if (!incoming.has(issueKey(item))) {
      events.push({ kind: "RECOVERED", studioCode: item.studioCode,
        domain: item.domain, code: item.code, severity: "info",
        evidence: null });
    }
  }
  return { issues: [...incoming.values()], events: events.slice(0, MAX_EVENTS),
    omittedEvents: Math.max(0, events.length - MAX_EVENTS) };
}

function step(agent, report, dependencies = []) {
  return { agent, runId: report.runId, status: report.status, dependencies };
}

export function formatFunctionalReport(report) {
  return [
    `# Atlas — verificação funcional ${report.status}`, "",
    `Fluxo: ${report.flowId}`, `Modo: ${report.mode}`,
    report.mode === "SYNTHETIC_SIMULATION"
      ? "Dados e estúdios desta execução são fixtures sintéticas; não representam produção."
      : "Sem fonte funcional RLS autorizada: nenhuma consulta funcional remota foi executada.",
    "", "## Integrações reais", "",
    ...report.integrations.map((item) => `- ${item.domain}: ${item.status}`),
    "", "## Anomalias observadas", "",
    ...(report.anomalies.length ? report.anomalies.map((item) =>
      `- ${item.studioCode} / ${item.domain}: ${item.code} [${item.severity}], contagem agregada ${item.evidence.aggregateCount}.`)
      : ["- Nenhuma anomalia funcional comprovada."]),
    "", "## Alertas locais novos ou recuperados", "",
    ...(report.events.length ? report.events.map((item) =>
      `- ${item.kind} ${item.severity}: ${item.studioCode} / ${item.code}.`)
      : ["- Nenhum alerta novo."]),
    "", "## Agentes", "",
    ...report.steps.map((item) =>
      `- ${item.agent} ${item.runId}: ${item.status}; depende de ${item.dependencies.join(", ") || "nenhuma"}.`),
    `- Sherlock: ${report.causeSummary}.`,
    `- Forge: ${report.proposalSummary}.`,
    `- Valida: ${report.testSummary} (sete contratos locais sintéticos; sem evidência de produção).`,
    `- Guardião: ${report.opinion}; publicação não autorizada.`,
    "", "Monitorização funcional recorrente: DESATIVADA.", "",
  ].join("\n");
}

export async function runFunctionalCheck({
  mode = "live", scenario = "baseline", stateDir = DEFAULT_STATE_DIR,
  now = () => new Date(), validate = () => runValida(),
} = {}) {
  if (!["live", "synthetic"].includes(mode)) throw new Error("INVALID_FUNCTIONAL_MODE");
  const flowId = runId();
  const release = acquireAtlasLock(stateDir, flowId, "functional-check", now);
  try {
    const state = readState(stateDir);
    const fixture = mode === "synthetic" ? functionalFixture(scenario, { now }) : null;
    const observedAt = now().toISOString();
    const monitoring = {
      agent: "sentinela", runId: runId(), observedAt,
      mode: fixture ? "SYNTHETIC_SIMULATION" : "LIVE_INTEGRATIONS_DISABLED",
      status: fixture ? "OBSERVADO_EM_FIXTURE" : "INDETERMINADO",
      anomalies: fixture ? inspectFunctionalSnapshot(fixture.snapshot) : [],
      integrations: FUNCTIONAL_INTEGRATIONS,
    };
    appendAtlasEvent(stateDir, { id: monitoring.runId, agent: "sentinela",
      state: "COMPLETED", flowId, status: monitoring.status, at: observedAt });
    const diagnosis = diagnoseFunctional({
      monitoring, syntheticProof: fixture?.syntheticProof, now });
    diagnosis.runId = runId();
    appendAtlasEvent(stateDir, { id: diagnosis.runId, agent: "sherlock",
      state: "COMPLETED", flowId, dependencies: [monitoring.runId],
      status: diagnosis.status, at: now().toISOString() });
    const proposal = planFunctionalCorrection({ diagnosis, monitoring, now });
    proposal.runId = runId();
    appendAtlasEvent(stateDir, { id: proposal.runId, agent: "forge",
      state: "COMPLETED", flowId, dependencies: [diagnosis.runId, monitoring.runId],
      status: proposal.status, at: now().toISOString() });
    const rawValidation = await validate();
    if (!rawValidation || rawValidation.agent !== "valida" ||
        !["APPROVED", "FAILED", "INDETERMINATE"].includes(rawValidation.status) ||
        !Array.isArray(rawValidation.tests) || rawValidation.tests.length !== 7 ||
        rawValidation.tests.some((item) => !["PASS", "FAIL", "INDETERMINATE"].includes(item.state)) ||
        (rawValidation.status === "APPROVED" &&
          rawValidation.tests.some((item) => item.state !== "PASS")) ||
        (rawValidation.status === "FAILED" &&
          !rawValidation.tests.some((item) => item.state === "FAIL"))) {
      throw new Error("FUNCTIONAL_VALIDATION_INVALID");
    }
    const validation = {
      agent: "valida", runId: runId(), observedAt: now().toISOString(),
      status: rawValidation.status,
      tests: rawValidation.tests.map((item) => ({ state: item.state })),
    };
    appendAtlasEvent(stateDir, { id: validation.runId, agent: "valida",
      state: "COMPLETED", flowId, dependencies: [proposal.runId],
      status: validation.status, at: validation.observedAt });
    const opinion = reviewFunctional({ monitoring, diagnosis, proposal, validation, now });
    opinion.runId = runId();
    appendAtlasEvent(stateDir, { id: opinion.runId, agent: "guardiao",
      state: "COMPLETED", flowId, dependencies: [
        monitoring.runId, diagnosis.runId, proposal.runId, validation.runId],
      status: opinion.status, at: now().toISOString() });
    const comparison = compareIssues(state.last,
      fixture ? monitoring.anomalies : null);
    const status = fixture
      ? monitoring.anomalies.length ? "ANOMALIAS_SINTETICAS" : "SEM_ANOMALIAS_SINTETICAS"
      : "PENDENTE_ACESSO_FUNCIONAL";
    const report = {
      flowId, observedAt, mode: monitoring.mode, status,
      integrations: FUNCTIONAL_INTEGRATIONS,
      anomalies: monitoring.anomalies,
      events: comparison.events, omittedEvents: comparison.omittedEvents ?? 0,
      activeIssueCount: comparison.issues.length,
      causeSummary: diagnosis.findings.length
        ? diagnosis.findings.map((item) => `${item.code} ${item.causeStatus}`).join(", ")
        : "nenhuma causa funcional comprovada",
      proposalSummary: proposal.plan
        ? `${proposal.plan.domain} / ${proposal.plan.studioCode}, não aplicada`
        : "nenhuma proposta acionável sem causa comprovada",
      testSummary: validation.status,
      opinion: opinion.status,
      publicationAuthorized: false, remoteWrites: false,
      recurringFunctionalMonitoringEnabled: false,
      steps: [
        step("sentinela", monitoring),
        step("sherlock", diagnosis, [monitoring.runId]),
        step("forge", proposal, [diagnosis.runId, monitoring.runId]),
        step("valida", validation, [proposal.runId]),
        step("guardiao", opinion, [
          monitoring.runId, diagnosis.runId, proposal.runId, validation.runId]),
      ],
    };
    const next = {
      schema: 1,
      last: fixture ? { runId: monitoring.runId, issues: comparison.issues } : state.last,
      journal: [...state.journal, {
        flowId, at: observedAt, mode: report.mode, status,
        issueKeys: comparison.issues.map(issueKey),
        eventCodes: comparison.events.map((item) => `${item.kind}:${item.code}:${item.studioCode}`),
      }].slice(-RETENTION),
      alerts: [...state.alerts, ...comparison.events.map((item) => ({
        flowId, at: observedAt, ...item,
      }))].slice(-RETENTION),
    };
    const dir = join(stateDir, "functional");
    atomicWrite(join(stateDir, "functional-state.json"), `${JSON.stringify(next, null, 2)}\n`);
    atomicWrite(join(dir, `${flowId}.json`), `${JSON.stringify(report, null, 2)}\n`);
    atomicWrite(join(dir, `${flowId}.md`), formatFunctionalReport(report));
    atomicWrite(join(stateDir, "latest-functional.md"), formatFunctionalReport(report));
    appendAtlasEvent(stateDir, { id: flowId, agent: "atlas", state: "COMPLETED",
      flowId, status, at: now().toISOString() });
    return { id: flowId, status, report,
      reportPath: join(stateDir, "latest-functional.md") };
  } finally {
    release();
  }
}
