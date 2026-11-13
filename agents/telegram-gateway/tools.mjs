import { existsSync, mkdirSync, readFileSync, renameSync,
  statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { diagnosePublic } from "../sherlock.mjs";
import { planPublicCorrection } from "../forge.mjs";
import { reviewPublic } from "../guardiao.mjs";
import { runApprovedTest, runValida } from "../valida.mjs";
import { atlasStatus, acquireAtlasLock, appendAtlasEvent } from "../atlas.mjs";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_JSON_BYTES = 1_000_000;
function readJson(path) {
  try {
    if (statSync(path).size > MAX_JSON_BYTES) throw new Error();
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { throw new Error("EVIDENCE_UNAVAILABLE"); }
}
function optionalJson(path) {
  try { return readJson(path); } catch { return null; }
}
function runFile(dir, id) {
  if (!UUID.test(id ?? "")) throw new Error("EVIDENCE_UNAVAILABLE");
  return join(dir, `${id}.json`);
}
function writeArtifact(stateDir, name, value) {
  const dir = join(stateDir, "shared");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
function artifact(stateDir, name) {
  return optionalJson(join(stateDir, "shared", name));
}
function freshness(at, now = new Date()) {
  const age = now.getTime() - Date.parse(at ?? "");
  return Number.isFinite(age) && age >= 0 && age <= 60 * 60_000
    ? "RECENTE" : "DESATUALIZADO";
}
function latest(monitorStateDir) {
  const monitor = readJson(join(monitorStateDir, "monitor-state.json"));
  const entry = monitor.journal?.at(-1);
  if (!entry || !UUID.test(entry.sentinelaRunId ?? ""))
    throw new Error("EVIDENCE_UNAVAILABLE");
  const sentinela = readJson(runFile(join(monitorStateDir, "runs"),
    entry.sentinelaRunId));
  const publicState = optionalJson(join(monitorStateDir, "public-integrated",
    "public-state.json"));
  const visualState = optionalJson(join(monitorStateDir, "visual-prepared",
    "visual-state.json"));
  const publicId = entry.publicRunId;
  const visualId = entry.visualRunId;
  const publicReport = UUID.test(publicId ?? "") ? optionalJson(runFile(
    join(monitorStateDir, "public-integrated", "public-runs"), publicId)) : null;
  const visualReport = UUID.test(visualId ?? "") ? optionalJson(runFile(
    join(monitorStateDir, "visual-prepared", "visual-runs"), visualId)) : null;
  return { monitor, entry, sentinela,
    publicState: publicState?.history?.at(-1)?.flowId === publicId
      ? publicState : null,
    visualState: visualState?.history?.at(-1)?.flowId === visualId
      ? visualState : null,
    publicReport, visualReport };
}
function sourceSummary(data, monitorStateDir) {
  let atlas;
  try { atlas = atlasStatus(monitorStateDir); }
  catch { atlas = { running: null }; }
  return { source: "MONITOR_HISTORY", observedAt: data.entry.at,
    freshness: freshness(data.entry.at),
    status: data.entry.overallStatus,
    overallStatus: data.entry.overallStatus,
    cloudflareStatus: data.sentinela.status,
    activeVersion: data.sentinela.observed?.activeVersion ?? null,
    bindingCount: data.sentinela.observed?.bindings?.length ?? null,
    publicStatus: data.publicReport?.status ?? "INDISPONIVEL",
    publicPages: data.publicReport ? `${data.publicReport.checkedPages}/${data.publicReport.expectedPages}` : null,
    publicSitemap: data.publicReport?.discoveryStatus ?? null,
    visualStatus: data.visualReport?.status ?? "INDISPONIVEL",
    visualPages: data.visualReport?.selectedCount ?? null,
    visualViews: data.visualReport?.pages?.length ?? null,
    knownPending: data.sentinela.anomalies?.filter((item) =>
      item.code === "OFFICIAL_RECORD_OUTDATED").map((item) => item.code) ?? [],
    atlasRunning: atlas.running ? { agent: atlas.running.agent ?? "UNKNOWN",
      startedAt: atlas.running.startedAt ?? null } : null,
  };
}
function studioFilter(studio) {
  if (studio === null || studio === "" || /^todos?$/i.test(studio ?? ""))
    return null;
  const value = String(studio).trim().toUpperCase().replace(/[ -]+/g, "_");
  const canonical = value === "STUDIO27" || value === "ESTUDIO_27"
    ? "STUDIO_27" : value;
  return canonical;
}
function safeAnomaly(item) {
  return { studioCode: item.studioCode ?? "GLOBAL",
    path: item.path ?? null, code: item.code, scope: item.scope ?? "PUBLIC_PAGE",
    severity: item.severity ?? "warning",
    evidence: { httpStatus: Number.isInteger(item.evidence?.httpStatus)
      ? item.evidence.httpStatus : null } };
}

export function createAgentTools({ monitorStateDir, stateDir,
  now = () => new Date() } = {}) {
  if (!monitorStateDir || !stateDir) throw new Error("TOOLS_CONFIG_INVALID");
  return Object.freeze({
    monitor_status() {
      return sourceSummary(latest(monitorStateDir), monitorStateDir);
    },
    monitor_history({ hours = 24 } = {}) {
      const data = latest(monitorStateDir);
      const cutoff = now().getTime() - (hours ?? 24) * 60 * 60_000;
      return { source: "HISTORY", windowHours: hours ?? 24,
        status: "HISTORICO", observedAt: data.entry.at,
        freshness: freshness(data.entry.at, now()),
        runs: data.monitor.journal.filter((item) =>
          Date.parse(item.at) >= cutoff).slice(-48).map((item) => ({
            id: item.monitorId, at: item.at, status: item.overallStatus,
            publicStatus: item.publicStatus,
            visualStatus: item.visualStatus ?? "NAO_ATIVO",
            events: item.eventCodes ?? [],
          })),
        alerts: data.monitor.alerts.filter((item) =>
          Date.parse(item.at) >= cutoff).length };
    },
    monitor_alerts() {
      const data = latest(monitorStateDir);
      return { source: "HISTORY", status: "HISTORICO",
        observedAt: data.entry.at, freshness: freshness(data.entry.at, now()),
        alerts: data.monitor.alerts.slice(-20)
        .map((item) => ({ id: `${item.monitorId}:${item.kind}:${item.code}`,
          at: item.at, kind: item.kind, code: item.code,
          severity: item.severity })) };
    },
    public_status({ studio = null } = {}) {
      const data = latest(monitorStateDir);
      const report = data.publicReport;
      if (!report || !Array.isArray(report.pages))
        return { source: "INDISPONIVEL", status: "NAO_VERIFICAVEL",
          observedAt: data.entry.at, freshness: freshness(data.entry.at, now()),
          reason: "RELATORIO_PUBLICO_DESTA_EXECUCAO_INDISPONIVEL" };
      const filter = studioFilter(studio);
      const pages = report.pages.filter((item) =>
        item && typeof item.studioCode === "string" &&
        typeof item.path === "string" && (!filter ||
          item.studioCode === filter));
      const visual = Array.isArray(data.visualReport?.pages)
        ? data.visualReport.pages : [];
      const codes = [...new Set(pages.map((item) => item.studioCode))];
      const studioSummary = codes.filter((code) => code !== "GLOBAL")
        .slice(0, 50).map((code) => {
          const own = pages.filter((item) => item.studioCode === code);
          const views = visual.filter((item) => item.studioCode === code);
          return { studioCode: code, httpPages: own.length,
            httpFailures: own.filter((item) => !item.complete ||
              item.status !== "PAGE_AND_ASSETS_OK").length,
            visualViews: views.length,
            visualFailures: views.filter((item) =>
              (item.jsErrors?.length ?? 0) > 0 ||
              (item.assetFailures?.length ?? 0) > 0 ||
              item.status !== "OBSERVED").length };
        });
      const selectedPages = filter ? pages.slice(0, 12).map((item) => ({
        studioCode: item.studioCode, path: item.path,
        httpStatus: item.httpStatus ?? null, status: item.status,
        complete: item.complete === true,
        visual: visual.filter((view) => view.path === item.path)
          .map((view) => ({ viewport: view.viewport,
            status: view.status, coverage: view.coverage,
            jsErrorCount: view.jsErrors?.length ?? 0,
            assetFailureCount: view.assetFailures?.length ?? 0 })),
      })) : [];
      const globalPages = pages.filter((item) => item.studioCode === "GLOBAL");
      const selectedVisual = filter ? visual.filter((item) =>
        item.studioCode === filter) : [];
      const visualFailures = selectedVisual.filter((item) =>
        (item.jsErrors?.length ?? 0) > 0 ||
        (item.assetFailures?.length ?? 0) > 0 ||
        item.status !== "OBSERVED").length;
      const httpFailures = pages.filter((item) => !item.complete ||
        item.status !== "PAGE_AND_ASSETS_OK").length;
      return { source: "MONITOR_HISTORY",
        status: filter ? !pages.length ? "NAO_VERIFICAVEL" :
          httpFailures ? "FALHA_PUBLICA" :
            visualFailures ? "FALHA_VISUAL" :
            "PAGINAS_E_RECURSOS_OK" : report.status,
        overallStatus: report.status,
        observedAt: report.observedAt, freshness: freshness(report.observedAt, now()),
        httpCoverage: `${report.checkedPages}/${report.expectedPages}`,
        coverageComplete: report.coverageComplete === true,
        agendaInteractivity: report.agendaInteractivity ?? "NAO_VERIFICAVEL",
        studioRequested: filter, studioFound: !filter || pages.length > 0,
        visualCoverage: filter ? !selectedVisual.length ? "NAO_VERIFICADA" :
          visualFailures ? "FALHA_VISUAL" : "OBSERVADA" :
          data.visualReport ? "AMOSTRA" : "NAO_VERIFICADA",
        global: { httpPages: globalPages.length,
          httpFailures: globalPages.filter((item) => !item.complete ||
            item.status !== "PAGE_AND_ASSETS_OK").length },
        studios: studioSummary, pages: selectedPages,
        visualObservedAt: data.visualReport?.observedAt ?? null };
    },
    diagnose_anomaly({ studio = null } = {}) {
      const data = latest(monitorStateDir);
      const active = [
        ...(data.publicState?.issues ?? []),
        ...(data.visualState?.issues ?? []),
      ].filter((item) => typeof item.code === "string").map(safeAnomaly);
      const historical = [
        ...(data.publicState?.alerts ?? []),
        ...(data.visualState?.alerts ?? []),
      ].filter((item) => item.kind === "NEW" && typeof item.code === "string")
        .slice(-20).map(safeAnomaly);
      const filter = studioFilter(studio);
      const activeSelected = active.filter((item) => !filter ||
        item.studioCode === filter).slice(0, 5);
      const selected = activeSelected.length ? activeSelected : historical
        .filter((item) => !filter || item.studioCode === filter).slice(-1);
      if (!selected.length) return { source: "INDISPONIVEL",
        status: "SEM_EVIDENCIA", causeStatus: "NAO_DETERMINADA" };
      const sourceRunIds = activeSelected.length
        ? [data.publicReport?.flowId, data.visualReport?.flowId].filter(Boolean)
        : [];
      const monitoring = { agent: "sentinela", runId: randomUUID(),
        anomalies: selected, sourceRunIds };
      const diagnosis = diagnosePublic({ monitoring, now });
      diagnosis.runId = randomUUID();
      writeArtifact(stateDir, "diagnosis.json", { monitoring, diagnosis,
        source: activeSelected.length ? "ACTIVE_READ_ONLY" : "HISTORICAL",
        at: now().toISOString() });
      return { source: activeSelected.length ? "ACTIVE_READ_ONLY" : "HISTORICAL",
        status: diagnosis.status, evidenceRunIds: sourceRunIds,
        findings: diagnosis.findings.map((item) => ({
          studioCode: item.studioCode, code: item.code,
          affected: item.affected, causeStatus: item.causeStatus,
        })) };
    },
    run_synthetic_tests() {
      if (existsSync(join(monitorStateDir, "monitor.lock")) ||
          existsSync(join(monitorStateDir, "atlas.lock")))
        throw new Error("MONITOR_CONFLICTING_RUN");
      const id = randomUUID();
      const release = acquireAtlasLock(stateDir, id, "valida", now);
      try {
        appendAtlasEvent(stateDir, { id, agent: "valida", state: "RUNNING",
          at: now().toISOString(), source: "TELEGRAM_SYNTHETIC_LOCAL" });
        const report = runValida({ runCase: (testCase) => runApprovedTest(testCase,
          { timeoutMs: 8_000 }), now });
        report.runId = id;
        writeArtifact(stateDir, "validation.json", { report, at: now().toISOString() });
        appendAtlasEvent(stateDir, { id, agent: "valida", state: "COMPLETED",
          at: now().toISOString(), status: report.status });
        return { source: "SYNTHETIC_LOCAL", status: report.status,
          observedAt: report.observedAt, tests: report.tests.map((item) => ({
            file: item.file, state: item.state, reason: item.reason,
          })), areas: report.areas };
      } finally { release(); }
    },
    prepare_investigation() {
      const evidence = artifact(stateDir, "diagnosis.json");
      if (!evidence || !Number.isFinite(Date.parse(evidence.at)) ||
          now().getTime() - Date.parse(evidence.at) > 24 * 60 * 60_000)
        return { source: "INDISPONIVEL", status: "BLOQUEADO",
          applied: false, reason: "DIAGNOSTICO_ATUAL_NECESSARIO" };
      const proposal = planPublicCorrection({ diagnosis: evidence.diagnosis, now });
      proposal.runId = randomUUID();
      writeArtifact(stateDir, "proposal.json", { ...evidence, proposal,
        at: now().toISOString() });
      return { source: evidence.source, status: proposal.status,
        plan: proposal.plan?.action ?? null, scope: proposal.plan?.scope ?? [],
        proposedPatch: null, applied: false,
        causeStatus: evidence.diagnosis.findings?.[0]?.causeStatus ??
          "NAO_DETERMINADA" };
    },
    review_proposal() {
      const chain = artifact(stateDir, "proposal.json");
      const validation = artifact(stateDir, "validation.json")?.report;
      if (!chain || !validation) return { source: "INDISPONIVEL",
        status: "INDETERMINADO", publicationAuthorized: false,
        reason: "EVIDENCIAS_OU_TESTES_INDISPONIVEIS" };
      const opinion = reviewPublic({ monitoring: chain.monitoring,
        diagnosis: chain.diagnosis, proposal: chain.proposal,
        validation, now });
      return { source: chain.source, status: opinion.status,
        checks: opinion.checks, risks: opinion.risks,
        publicationAuthorized: false, deployAllowed: false };
    },
  });
}
