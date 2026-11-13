import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_STATE_DIR, acquireAtlasLock, appendAtlasEvent } from "./atlas.mjs";
import { scanVisualPages } from "./visual-probes.mjs";
import { visualFixture } from "./visual-fixtures.mjs";
import { diagnosePublic } from "./sherlock.mjs";
import { planPublicCorrection } from "./forge.mjs";
import { runValida } from "./valida.mjs";
import { reviewPublic } from "./guardiao.mjs";

const key = (issue) => `${issue.path}:${issue.viewport}:${issue.code}`;
const MAX_HISTORY = 60;

function readState(stateDir) {
  const path = join(stateDir, "visual-state.json");
  if (!existsSync(path)) return { schema: 1, issues: [], history: [], alerts: [] };
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("VISUAL_STATE_INVALID"); }
  if (state?.schema !== 1 || !Array.isArray(state.issues) ||
      !Array.isArray(state.history) || !Array.isArray(state.alerts) ||
      state.issues.length > 100 || state.history.length > MAX_HISTORY ||
      state.alerts.length > MAX_HISTORY) throw new Error("VISUAL_STATE_INVALID");
  return state;
}

function save(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, value, { mode: 0o600 });
  renameSync(temp, path);
}

function compare(previous, current, pages) {
  const old = new Map(previous.map((item) => [key(item), item]));
  const next = new Map(current.map((item) => [key(item), item]));
  const events = [];
  for (const item of next.values()) if (!old.has(key(item)))
    events.push({ kind: "NEW", path: item.path, studioCode: item.studioCode,
      viewport: item.viewport, code: item.code, severity: item.severity });
  for (const item of old.values()) if (!next.has(key(item))) {
    const page = pages.find((entry) => entry.path === item.path &&
      entry.viewport === item.viewport);
    if (page?.status === "OBSERVED" && page.blockedRequests === 0) {
      events.push({ kind: "RECOVERED", path: item.path,
        studioCode: item.studioCode, viewport: item.viewport,
        code: item.code, severity: "info" });
    } else next.set(key(item), item);
  }
  return { issues: [...next.values()], events };
}

export function formatVisualReport(report) {
  return [
    `# Atlas — verificação visual ${report.status}`, "",
    `Fluxo: ${report.flowId}`, `Modo: ${report.mode}`,
    `Cobertura: ${report.pages.length} renderizações de ${report.selectedCount} páginas; ${report.discoveredCount} páginas públicas enumeradas.`,
    `Pedidos permitidos: ${report.requests}. Capturas mantidas somente em memória.`,
    "", "## Páginas", "",
    ...report.pages.map((item) => `- ${item.path} ${item.viewport}: ${item.status}; HTTP ${item.httpStatus ?? "indisponível"}; ` +
      `main ${item.dom?.mainVisible ? "visível" : "não comprovado"}; erros JS ${item.jsErrors?.length ?? 0}; ` +
      `recursos falhados ${item.assetFailures?.length ?? 0}; bloqueios de política ${item.blockedRequests ?? 0}; ${item.coverage}.`),
    "", "## Anomalias e alertas", "",
    ...(report.issues.length ? report.issues.map((item) =>
      `- ${item.path} ${item.viewport}: ${item.code} [${item.severity}]; evidência ${JSON.stringify(item.evidence)}.`)
      : ["- Nenhuma falha confirmada na cobertura verificada."]),
    ...(report.events.length ? report.events.map((item) =>
      `- ${item.kind} ${item.path} ${item.viewport}: ${item.code}.`) : ["- Nenhum alerta novo."]),
    "", "## Agentes", "",
    `- Sentinela: ${report.sentinelaRunId}; Sherlock: ${report.sherlockStatus}; causa ${report.causeStatus}.`,
    `- Forge: ${report.forgeStatus}, sem patch aplicado; Valida: ${report.validaStatus}.`,
    `- Guardião: ${report.guardiaoStatus}; publicação não autorizada.`,
    "", "## Limites", "",
    "- Pedidos a APIs e terceiros são bloqueados. A agenda interativa e reservas permanecem NÃO VERIFICÁVEIS quando dependem desses pedidos ou de login.",
    "- Erros de rede causados pela política são classificados como cobertura limitada, sem atribuição de causa à Bellza.",
    "- Não foram usados dados pessoais, cookies persistentes, credenciais, formulários ou ações de escrita.",
    "- Execução recorrente visual: DESATIVADA.", "",
  ].join("\n");
}

export async function runVisualCheck({ mode = "live", scenario = "healthy",
  stateDir = null, now = () => new Date(), scan = scanVisualPages,
  validate = () => runValida() } = {}) {
  if (!["live", "synthetic"].includes(mode)) throw new Error("INVALID_VISUAL_MODE");
  const flowId = randomUUID();
  stateDir ??= join(DEFAULT_STATE_DIR, mode === "live" ? "visual-manual" : "visual-simulated");
  const release = acquireAtlasLock(stateDir, flowId, "visual-check", now);
  try {
    mkdirSync(stateDir, { recursive: true });
    const state = readState(stateDir);
    const fixture = mode === "synthetic" ? visualFixture(scenario) : {};
    const scanResult = await scan(fixture);
    const pages = scanResult.pages ?? [];
    const issues = pages.flatMap((page) => page.issues ?? []);
    const sentinela = { agent: "sentinela", runId: randomUUID(),
      status: scanResult.status, anomalies: issues, mode: mode === "live"
        ? "PUBLIC_VISUAL_READ_ONLY" : "SYNTHETIC_SIMULATION" };
    appendAtlasEvent(stateDir, { id: sentinela.runId, agent: "sentinela",
      flowId, state: "COMPLETED", status: sentinela.status, at: now().toISOString() });
    const diagnosis = diagnosePublic({ monitoring: sentinela, now });
    diagnosis.runId = randomUUID();
    const proposal = planPublicCorrection({ diagnosis, now });
    proposal.runId = randomUUID();
    const rawValidation = await validate();
    if (rawValidation?.agent !== "valida" || !["APPROVED", "FAILED",
      "INDETERMINATE"].includes(rawValidation.status) ||
      !Array.isArray(rawValidation.tests) || rawValidation.tests.length !== 7)
      throw new Error("VISUAL_VALIDATION_INVALID");
    const validation = { agent: "valida", runId: randomUUID(),
      status: rawValidation.status, tests: rawValidation.tests.map((item) =>
        ({ state: item.state })) };
    const opinion = reviewPublic({ monitoring: sentinela, diagnosis,
      proposal, validation, now });
    opinion.runId = randomUUID();
    for (const [agent, id, dependencies, status] of [
      ["sherlock", diagnosis.runId, [sentinela.runId], diagnosis.status],
      ["forge", proposal.runId, [diagnosis.runId], proposal.status],
      ["valida", validation.runId, [proposal.runId], validation.status],
      ["guardiao", opinion.runId, [sentinela.runId, diagnosis.runId,
        proposal.runId, validation.runId], opinion.status],
    ]) appendAtlasEvent(stateDir, { id, agent, flowId, dependencies,
      state: "COMPLETED", status, at: now().toISOString() });
    const comparison = compare(state.issues, issues, pages);
    const partial = scanResult.status !== "OBSERVED" ||
      pages.some((page) => page.status !== "OBSERVED" ||
        page.coverage === "AGENDA_NAO_VERIFICAVEL");
    const status = issues.length ? "FALHAS_OBSERVADAS" :
      partial ? "PARCIAL" : "SEM_FALHAS_OBSERVADAS";
    const report = { flowId, observedAt: now().toISOString(),
      mode: sentinela.mode, status, sentinelaRunId: sentinela.runId,
      pages, selectedCount: scanResult.selectedCount ?? 0,
      discoveredCount: scanResult.discoveredCount ?? 0,
      requests: scanResult.requests ?? 0, issues, events: comparison.events,
      sherlockStatus: diagnosis.status,
      causeStatus: diagnosis.findings.length ? "NAO_DETERMINADA" : "SEM_ANOMALIAS",
      forgeStatus: proposal.status,
      validaStatus: validation.status, guardiaoStatus: opinion.status,
      publicationAuthorized: false, remoteWrites: false,
      recurringEnabled: false };
    const next = { schema: 1, issues: comparison.issues,
      history: [...state.history, { flowId, at: report.observedAt,
        status, issueKeys: comparison.issues.map(key) }].slice(-MAX_HISTORY),
      alerts: [...state.alerts, ...comparison.events.map((item) => ({
        flowId, at: report.observedAt, ...item }))].slice(-MAX_HISTORY) };
    const reportsDir = join(stateDir, "visual-runs");
    mkdirSync(reportsDir, { recursive: true });
    save(join(stateDir, "visual-state.json"), `${JSON.stringify(next, null, 2)}\n`);
    save(join(reportsDir, `${flowId}.json`), `${JSON.stringify(report, null, 2)}\n`);
    save(join(reportsDir, `${flowId}.md`), formatVisualReport(report));
    const reportPath = join(stateDir, "latest-visual.md");
    save(reportPath, formatVisualReport(report));
    appendAtlasEvent(stateDir, { id: flowId, agent: "atlas", flowId,
      state: "COMPLETED", status, at: now().toISOString() });
    return { id: flowId, status, report, reportPath };
  } finally { release(); }
}
