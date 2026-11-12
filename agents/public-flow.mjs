import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync,
  writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_STATE_DIR, acquireAtlasLock, appendAtlasEvent } from "./atlas.mjs";
import { runPublicSentinela, classifyPublicSnapshot } from "./sentinela.mjs";
import { diagnosePublic } from "./sherlock.mjs";
import { planPublicCorrection } from "./forge.mjs";
import { runValida } from "./valida.mjs";
import { reviewPublic } from "./guardiao.mjs";
import { publicFixture } from "./public-fixtures.mjs";

const MAX_HISTORY = 240;
const issueKey = (issue) => `${issue.path}:${issue.code}`;
const safeIssue = (issue) => ({ studioCode: issue.studioCode, path: issue.path,
  code: issue.code, severity: issue.severity, scope: issue.scope, evidence: issue.evidence });

function readState(stateDir) {
  const path = join(stateDir, "public-state.json");
  if (!existsSync(path)) return { schema: 1, issues: [], history: [], alerts: [] };
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("PUBLIC_STATE_INVALID"); }
  if (state?.schema !== 1 || !Array.isArray(state.issues) ||
      !Array.isArray(state.history) || !Array.isArray(state.alerts) ||
      state.issues.length > 65 || state.history.length > MAX_HISTORY ||
      state.alerts.length > MAX_HISTORY) throw new Error("PUBLIC_STATE_INVALID");
  return state;
}

function writeAtomic(path, content) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

function prunePublicReports(stateDir, removed, retained) {
  const kept = new Set(retained.map((item) => item.flowId));
  for (const entry of removed) {
    const id = entry.flowId;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id ?? "") ||
        kept.has(id)) continue;
    const base = join(stateDir, "public-runs", id);
    try {
      const report = JSON.parse(readFileSync(`${base}.json`, "utf8"));
      if (report.flowId !== id || !["PUBLIC_READ_ONLY", "SYNTHETIC_SIMULATION"]
        .includes(report.mode)) continue;
      unlinkSync(`${base}.json`);
      if (existsSync(`${base}.md`)) unlinkSync(`${base}.md`);
    } catch { /* An uncertain local file remains for manual review. */ }
  }
}

function compareIssues(previous, current, pages) {
  const old = new Map(previous.map((item) => [issueKey(item), item]));
  const incoming = new Map(current.map((item) => [issueKey(item), item]));
  const events = [];
  for (const issue of incoming.values()) if (!old.has(issueKey(issue)))
    events.push({ kind: "NEW", studioCode: issue.studioCode, path: issue.path,
      code: issue.code,
      severity: issue.severity });
  for (const issue of old.values()) {
    if (incoming.has(issueKey(issue))) continue;
    if (pages.find((page) => page.path === issue.path)?.complete) {
      events.push({ kind: "RECOVERED", studioCode: issue.studioCode,
        path: issue.path, code: issue.code, severity: "info" });
    } else incoming.set(issueKey(issue), issue); // An incomplete read cannot prove recovery.
  }
  return { issues: [...incoming.values()], events };
}

function step(report, dependencies = []) {
  return { agent: report.agent, runId: report.runId, status: report.status,
    dependencies };
}

export function formatPublicReport(report) {
  return [
    `# Atlas — monitorização pública ${report.status}`, "",
    `Fluxo: ${report.flowId}`, `Modo: ${report.mode}`, `Data: ${report.observedAt}`,
    `Cobertura: ${report.checkedPages}/${report.expectedPages} páginas; sitemap ${report.discoveryStatus}; ${report.requests} pedidos GET/HEAD.`,
    "", "## Páginas e estúdios", "",
    ...report.pages.map((page) => `- ${page.studioCode} ${page.path}: ${page.status}` +
      ` (HTTP ${page.httpStatus ?? "indisponível"}; JS ${page.script}; CSS ${page.style}` +
      `; rota JS ${page.routeScript}` +
      `${page.path.startsWith("/s/") ? `; interface ${page.bookingShell ? "estrutura presente" : "não comprovada"}` : ""}).`),
    "", "## Anomalias e alertas", "",
    ...(report.anomalies.length ? report.anomalies.map((item) =>
      `- ${item.path}: ${item.code} [${item.severity}; ${item.scope}].`)
      : ["- Nenhuma falha nas páginas e recursos verificados."]),
    ...(report.events.length ? report.events.map((item) =>
      `- ${item.kind}: ${item.path} / ${item.code}.`) : ["- Nenhum alerta novo."]),
    "", "## Agentes", "",
    ...report.steps.map((item) => `- ${item.agent} ${item.status}; depende de ${item.dependencies.join(", ") || "nenhuma"}.`),
    `- Sherlock: ${report.causeSummary}.`,
    `- Forge: ${report.proposalSummary}.`,
    `- Valida: ${report.tests}. Guardião: ${report.opinion}.`,
    "", "## Limites", "",
    "- Agenda interativa, horários, reservas e erros JavaScript em runtime: NÃO VERIFICÁVEIS nesta leitura estática.",
    "- A estrutura HTML, HTTP 200 e recursos acessíveis não comprovam funcionamento da agenda.",
    "- Nenhum login, formulário, credencial ou dado privado foi usado. Nenhuma alteração ou publicação foi autorizada.",
    "- Verificação pública recorrente: DESATIVADA.", "",
  ].join("\n");
}

export async function runPublicCheck({ mode = "live", scenario = "healthy",
  stateDir = null,
  fetchImpl, now = () => new Date(), validate = () => runValida(),
  maxScanDurationMs = 150_000 } = {}) {
  if (!["live", "synthetic"].includes(mode) || (mode === "synthetic" &&
      !["healthy", "studio-failure", "resource-failure", "network-failure"].includes(scenario)))
    throw new Error("INVALID_PUBLIC_MODE");
  stateDir ??= join(DEFAULT_STATE_DIR, mode === "synthetic"
    ? "public-simulated" : "public-live");
  const flowId = randomUUID();
  const release = acquireAtlasLock(stateDir, flowId, "public-check", now);
  try {
    mkdirSync(stateDir, { recursive: true });
    const state = readState(stateDir);
    const snapshot = await runPublicSentinela({
      fetchImpl: mode === "synthetic" ? publicFixture(scenario) : fetchImpl ?? fetch, now,
      delayMs: mode === "live" ? 200 : 0,
      maxDurationMs: maxScanDurationMs,
    });
    const monitoring = { agent: "sentinela", runId: randomUUID(),
      observedAt: snapshot.observedAt, status: snapshot.pages.every((item) => item.complete)
        ? "PAGINAS_E_RECURSOS_DISPONIVEIS" : "ANOMALIAS_OU_LEITURA_INCOMPLETA",
      anomalies: classifyPublicSnapshot(snapshot), mode: mode === "synthetic"
        ? "SYNTHETIC_SIMULATION" : "PUBLIC_READ_ONLY" };
    appendAtlasEvent(stateDir, { id: monitoring.runId, agent: "sentinela",
      flowId, state: "COMPLETED", status: monitoring.status, at: snapshot.observedAt });
    const diagnosis = diagnosePublic({ monitoring, now });
    diagnosis.runId = randomUUID();
    appendAtlasEvent(stateDir, { id: diagnosis.runId, agent: "sherlock",
      flowId, state: "COMPLETED", status: diagnosis.status,
      dependencies: [monitoring.runId], at: now().toISOString() });
    const proposal = planPublicCorrection({ diagnosis, now });
    proposal.runId = randomUUID();
    appendAtlasEvent(stateDir, { id: proposal.runId, agent: "forge",
      flowId, state: "COMPLETED", status: proposal.status,
      dependencies: [diagnosis.runId], at: now().toISOString() });
    const rawTests = await validate();
    if (rawTests?.agent !== "valida" ||
        !["APPROVED", "FAILED", "INDETERMINATE"].includes(rawTests.status) ||
        !Array.isArray(rawTests.tests) || rawTests.tests.length !== 7)
      throw new Error("PUBLIC_VALIDATION_INVALID");
    const validation = { agent: "valida", runId: randomUUID(),
      status: rawTests.status, observedAt: now().toISOString(),
      tests: rawTests.tests.map((item) => ({ state: item.state })) };
    appendAtlasEvent(stateDir, { id: validation.runId, agent: "valida",
      flowId, state: "COMPLETED", status: validation.status,
      dependencies: [proposal.runId], at: validation.observedAt });
    const opinion = reviewPublic({ monitoring, diagnosis, proposal, validation, now });
    opinion.runId = randomUUID();
    appendAtlasEvent(stateDir, { id: opinion.runId, agent: "guardiao",
      flowId, state: "COMPLETED", status: opinion.status,
      dependencies: [monitoring.runId, diagnosis.runId, proposal.runId,
        validation.runId], at: now().toISOString() });
    const comparison = compareIssues(state.issues, monitoring.anomalies, snapshot.pages);
    const coverageComplete = snapshot.discoveryStatus === "OK" &&
      snapshot.checkedPages === snapshot.expectedPages &&
      snapshot.pages.every((page) => !["RESOURCE_UNKNOWN", "NETWORK_ERROR",
        "HTML_READ_ERROR", "NOT_CHECKED_LIMIT"].includes(page.status));
    const status = monitoring.anomalies.length ? "ANOMALIAS" :
      coverageComplete && snapshot.pages.every((item) => item.complete)
        ? "PAGINAS_E_RECURSOS_OK" : "INDETERMINADO";
    const report = {
      flowId, observedAt: snapshot.observedAt, mode: monitoring.mode, status,
      discoveryStatus: snapshot.discoveryStatus, sitemapUrls: snapshot.sitemapUrls,
      expectedPages: snapshot.expectedPages, checkedPages: snapshot.checkedPages,
      coverageComplete,
      pages: snapshot.pages, anomalies: monitoring.anomalies.map(safeIssue),
      events: comparison.events, requests: snapshot.requests,
      agendaInteractivity: snapshot.agendaInteractivity,
      causeSummary: diagnosis.findings.length ? "causa não determinada; evidência pública limitada" : "nenhuma falha observada",
      proposalSummary: proposal.plan ? "plano de investigação não aplicado" : "nenhuma proposta",
      tests: validation.status, opinion: opinion.status,
      remoteWrites: false, publicationAuthorized: false, recurringEnabled: false,
      steps: [step(monitoring), step(diagnosis, [monitoring.runId]),
        step(proposal, [diagnosis.runId]), step(validation, [proposal.runId]),
        step(opinion, [monitoring.runId, diagnosis.runId, proposal.runId,
          validation.runId])],
    };
    const allHistory = [...state.history, { flowId, at: report.observedAt,
      mode: report.mode, status, issueKeys: comparison.issues.map(issueKey) }];
    const next = { schema: 1, issues: comparison.issues.map(safeIssue),
      history: allHistory.slice(-MAX_HISTORY),
      alerts: [...state.alerts, ...comparison.events.map((event) => ({
        flowId, at: report.observedAt, ...event }))].slice(-MAX_HISTORY) };
    const out = join(stateDir, "public-runs");
    mkdirSync(out, { recursive: true });
    writeAtomic(join(stateDir, "public-state.json"), `${JSON.stringify(next, null, 2)}\n`);
    prunePublicReports(stateDir, allHistory.slice(0, -MAX_HISTORY), next.history);
    writeAtomic(join(out, `${flowId}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeAtomic(join(out, `${flowId}.md`), formatPublicReport(report));
    const reportPath = join(stateDir, "latest-public.md");
    writeAtomic(reportPath, formatPublicReport(report));
    appendAtlasEvent(stateDir, { id: flowId, agent: "atlas", state: "COMPLETED",
      flowId, status, at: now().toISOString() });
    return { id: flowId, status, report, reportPath };
  } finally { release(); }
}
