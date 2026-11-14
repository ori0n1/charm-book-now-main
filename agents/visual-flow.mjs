import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync,
  writeFileSync } from "node:fs";
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
  if (!existsSync(path)) return { schema: 1, issues: [], history: [], alerts: [],
    rotationCycle: 0, sitemapFailureStreak: 0, sitemapCache: null };
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("VISUAL_STATE_INVALID"); }
  if (state?.schema !== 1 || !Array.isArray(state.issues) ||
      !Array.isArray(state.history) || !Array.isArray(state.alerts) ||
      state.issues.length > 100 || state.history.length > MAX_HISTORY ||
      state.alerts.length > MAX_HISTORY ||
      !Number.isSafeInteger(state.rotationCycle ?? 0) ||
      (state.rotationCycle ?? 0) < 0 ||
      !Number.isSafeInteger(state.sitemapFailureStreak ?? 0) ||
      (state.sitemapFailureStreak ?? 0) < 0 ||
      (state.sitemapCache !== undefined && state.sitemapCache !== null &&
        (!Array.isArray(state.sitemapCache.paths) ||
          state.sitemapCache.paths.length > 60 ||
          typeof state.sitemapCache.observedAt !== "string")))
    throw new Error("VISUAL_STATE_INVALID");
  return state;
}

function save(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, value, { mode: 0o600 });
  renameSync(temp, path);
}

function pruneReports(stateDir, removed, retained) {
  const keep = new Set(retained.map((item) => item.flowId));
  for (const item of removed) {
    const id = item.flowId;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id ?? "") ||
        keep.has(id)) continue;
    const base = join(stateDir, "visual-runs", id);
    try {
      const report = JSON.parse(readFileSync(`${base}.json`, "utf8"));
      if (report.flowId !== id || !["PUBLIC_VISUAL_READ_ONLY",
        "SYNTHETIC_SIMULATION"].includes(report.mode)) continue;
      unlinkSync(`${base}.json`);
      if (existsSync(`${base}.md`)) unlinkSync(`${base}.md`);
    } catch { /* Estado incerto: preservar para revisão local. */ }
  }
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
    `Sitemap: ${report.sitemapStatus}${report.sitemapFailure ? ` (${report.sitemapFailure}${report.sitemapHttpStatus ? ` HTTP ${report.sitemapHttpStatus}` : ""})` : ""}; última lista válida: ${report.sitemapLastValidAt ?? "indisponível"}.`,
    `Amostra rotativa: ciclo ${report.rotationCycle}; páginas fora deste ciclo não foram verificadas visualmente.`,
    `Duração: ${report.elapsedMs ?? "indisponível"} ms; pico RSS do processo Node: ${report.peakNodeRssBytes ?? "indisponível"} bytes (Chromium não incluído).`,
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
  validate = () => runValida(), maxScanDurationMs = 110_000 } = {}) {
  if (!["live", "synthetic"].includes(mode)) throw new Error("INVALID_VISUAL_MODE");
  const flowId = randomUUID();
  stateDir ??= join(DEFAULT_STATE_DIR, mode === "live" ? "visual-manual" : "visual-simulated");
  const release = acquireAtlasLock(stateDir, flowId, "visual-check", now);
  try {
    mkdirSync(stateDir, { recursive: true });
    const state = readState(stateDir);
    const fixture = mode === "synthetic" ? visualFixture(scenario) : {};
    const cycle = state.rotationCycle ?? 0;
    const scanResult = await scan({ ...fixture, cachedSitemap: state.sitemapCache ?? null,
      cycle, maxDurationMs: maxScanDurationMs });
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
    const previousFailures = state.sitemapFailureStreak ?? 0;
    const failureStreak = scanResult.sitemapFailure ? Math.min(1_000_000,
      previousFailures + 1) : 0;
    const discoveryEvents = [];
    if (failureStreak === 2) discoveryEvents.push({ kind: "NEW",
      path: "/sitemap.xml", studioCode: "GLOBAL",
      code: "VISUAL_SITEMAP_UNAVAILABLE", severity: "warning" });
    if (!scanResult.sitemapFailure && previousFailures >= 2)
      discoveryEvents.push({ kind: "RECOVERED", path: "/sitemap.xml",
        studioCode: "GLOBAL", code: "VISUAL_SITEMAP_UNAVAILABLE",
        severity: "info" });
    if (scanResult.sitemapStatus === "CHANGED")
      discoveryEvents.push({ kind: "CHANGED", path: "/sitemap.xml",
        studioCode: "GLOBAL", code: "VISUAL_SITEMAP_CHANGED", severity: "info" });
    const events = [...comparison.events, ...discoveryEvents];
    const monitorCoverageIncomplete = issues.some((issue) =>
      issue.scope === "MONITOR_COVERAGE");
    const applicationIssues = issues.some((issue) =>
      issue.scope !== "MONITOR_COVERAGE");
    const partial = monitorCoverageIncomplete || scanResult.status !== "OBSERVED" ||
      !["OK", "CHANGED"].includes(scanResult.sitemapStatus ?? "UNKNOWN") ||
      pages.some((page) => page.status !== "OBSERVED" ||
        page.coverage === "AGENDA_NAO_VERIFICAVEL");
    const status = applicationIssues ? "FALHAS_OBSERVADAS" :
      partial ? "PARCIAL" : "SEM_FALHAS_OBSERVADAS";
    const report = { flowId, observedAt: now().toISOString(),
      mode: sentinela.mode, status, sentinelaRunId: sentinela.runId,
      pages, selectedCount: scanResult.selectedCount ?? 0,
      discoveredCount: scanResult.discoveredCount ?? 0,
      requests: scanResult.requests ?? 0, issues, events,
      sitemapStatus: scanResult.sitemapStatus ?? "UNKNOWN",
      sitemapFailure: scanResult.sitemapFailure ?? null,
      sitemapHttpStatus: scanResult.sitemapHttpStatus ?? null,
      sitemapLastValidAt: scanResult.sitemapSnapshot?.observedAt ??
        state.sitemapCache?.observedAt ?? null,
      rotationCycle: cycle, elapsedMs: scanResult.elapsedMs ?? null,
      peakNodeRssBytes: scanResult.peakNodeRssBytes ?? null,
      sherlockStatus: diagnosis.status,
      causeStatus: diagnosis.findings.length ? "NAO_DETERMINADA" : "SEM_ANOMALIAS",
      forgeStatus: proposal.status,
      validaStatus: validation.status, guardiaoStatus: opinion.status,
      publicationAuthorized: false, remoteWrites: false,
      recurringEnabled: false };
    const historyAll = [...state.history, { flowId, at: report.observedAt,
      status, issueKeys: comparison.issues.map(key) }];
    const next = { schema: 1, issues: comparison.issues,
      rotationCycle: scanResult.status === "OBSERVED" ||
        scanResult.status === "PARTIAL_LIMIT" ? cycle + 1 : cycle,
      sitemapFailureStreak: failureStreak,
      sitemapCache: scanResult.sitemapSnapshot ?? state.sitemapCache ?? null,
      history: historyAll.slice(-MAX_HISTORY),
      alerts: [...state.alerts, ...events.map((item) => ({
        flowId, at: report.observedAt, ...item }))].slice(-MAX_HISTORY) };
    const reportsDir = join(stateDir, "visual-runs");
    mkdirSync(reportsDir, { recursive: true });
    save(join(stateDir, "visual-state.json"), `${JSON.stringify(next, null, 2)}\n`);
    pruneReports(stateDir, historyAll.slice(0, -MAX_HISTORY), next.history);
    save(join(reportsDir, `${flowId}.json`), `${JSON.stringify(report, null, 2)}\n`);
    save(join(reportsDir, `${flowId}.md`), formatVisualReport(report));
    const reportPath = join(stateDir, "latest-visual.md");
    save(reportPath, formatVisualReport(report));
    appendAtlasEvent(stateDir, { id: flowId, agent: "atlas", flowId,
      state: "COMPLETED", status, at: now().toISOString() });
    return { id: flowId, status, report, reportPath };
  } finally { release(); }
}
