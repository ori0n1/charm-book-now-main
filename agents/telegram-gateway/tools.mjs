import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { diagnosePublic, diagnoseSentinela } from "../sherlock.mjs";
import { planPublicCorrection } from "../forge.mjs";
import { reviewPublic } from "../guardiao.mjs";
import { runApprovedTest, runValida } from "../valida.mjs";
import { atlasStatus, acquireAtlasLock, appendAtlasEvent } from "../atlas.mjs";
import { prepareReferencePatchWorkspace } from "./patch-worktree.mjs";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_JSON_BYTES = 1_000_000;
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const CODE_CONTEXT = Object.freeze({
  agenda: ["src/hooks/use-agenda-view.ts", "src/lib/agenda-access.functions.ts"],
  reservas: ["src/lib/booking.ts", "src/lib/public-booking.functions.ts"],
  clientes: ["src/lib/client-duplicates.ts", "src/lib/client-profile-core.ts"],
  notificacoes: ["src/lib/appointment-whatsapp-policy.ts"],
  pagamentos: ["src/lib/payment-amount.ts", "src/lib/payments.functions.ts"],
  publico: ["src/components/booking-experience.tsx", "src/routes/login.tsx"],
});
function codeContext(codes = []) {
  const joined = codes.join(" ").toUpperCase();
  const areas = Object.keys(CODE_CONTEXT).filter((name) => {
    const patterns = {
      agenda: /AGENDA|AVAILABILITY/, reservas: /BOOKING|RESERV/,
      clientes: /CLIENT|DUPLICATE/, notificacoes: /WHATSAPP|NOTIF/,
      pagamentos: /PAYMENT|STRIPE/, publico: /PUBLIC|VISUAL|RESOURCE|HTTP/,
    };
    return patterns[name].test(joined);
  }).slice(0, 2);
  return { source: "LOCAL_CODE", status: areas.length ? "REFERENCIAS" :
    "SEM_MAPEAMENTO", causeStatus: "NAO_DETERMINADA",
    files: areas.flatMap((area) => CODE_CONTEXT[area]).slice(0, 4)
      .flatMap((file) => {
        try {
          const body = readFileSync(join(sourceRoot, file));
          if (body.byteLength > 500_000) return [];
          return [{ file, sha256: createHash("sha256").update(body)
            .digest("hex").slice(0, 16) }];
        } catch { return []; }
      }) };
}
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
function pruneTaskDiagnoses(stateDir) {
  const dir = join(stateDir, "shared");
  const files = readdirSync(dir).filter((name) =>
    /^diagnosis-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/.test(name));
  if (files.length <= 200) return;
  const ordered = files.map((name) => ({ name,
    at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at);
  for (const item of ordered.slice(0, files.length - 200)) {
    try { unlinkSync(join(dir, item.name)); }
    catch { /* Retention failure leaves evidence intact. */ }
  }
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
    monitorId: data.entry.monitorId,
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
  return { studioCode: /^[A-Z0-9_]{2,40}$/.test(item.studioCode ?? "")
    ? item.studioCode : "UNKNOWN",
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
    diagnose_anomaly({ studio = null, taskId = null } = {}) {
      const consulted = [];
      const unavailable = [];
      const monitor = optionalJson(join(monitorStateDir, "monitor-state.json"));
      const entry = Array.isArray(monitor?.journal) ? monitor.journal.at(-1) : null;
      const validEntry = UUID.test(entry?.monitorId ?? "") &&
        UUID.test(entry?.sentinelaRunId ?? "") &&
        Number.isFinite(Date.parse(entry?.at ?? ""));
      if (validEntry) consulted.push("MONITOR_JOURNAL");
      else unavailable.push("MONITOR_JOURNAL");
      const sentinela = validEntry ? optionalJson(runFile(
        join(monitorStateDir, "runs"), entry.sentinelaRunId)) : null;
      const currentReport = sentinela?.agent === "sentinela" &&
        sentinela.runId === entry?.sentinelaRunId &&
        Array.isArray(sentinela.anomalies) && Array.isArray(sentinela.checks)
        ? sentinela : null;
      if (currentReport) consulted.push("CURRENT_SENTINELA_REPORT");
      else if (validEntry) unavailable.push("CURRENT_SENTINELA_REPORT");
      let priorReport = null;
      if (validEntry && !currentReport) {
        for (const prior of monitor.journal.slice(-6, -1).reverse()) {
          if (!UUID.test(prior?.sentinelaRunId ?? "")) continue;
          const candidate = optionalJson(runFile(join(monitorStateDir, "runs"),
            prior.sentinelaRunId));
          if (candidate?.agent === "sentinela" &&
              candidate.runId === prior.sentinelaRunId &&
              Array.isArray(candidate.anomalies)) {
            priorReport = candidate;
            consulted.push("PRIOR_SENTINELA_REPORT");
            break;
          }
        }
      }
      const publicRaw = optionalJson(join(monitorStateDir, "public-integrated",
        "public-state.json"));
      const visualRaw = optionalJson(join(monitorStateDir, "visual-prepared",
        "visual-state.json"));
      const publicState = validEntry && UUID.test(entry.publicRunId ?? "") &&
        Array.isArray(publicRaw?.history) &&
        publicRaw.history.at(-1)?.flowId === entry.publicRunId &&
        Array.isArray(publicRaw.issues) ? publicRaw : null;
      const visualState = validEntry && UUID.test(entry.visualRunId ?? "") &&
        Array.isArray(visualRaw?.history) &&
        visualRaw.history.at(-1)?.flowId === entry.visualRunId &&
        Array.isArray(visualRaw.issues) ? visualRaw : null;
      if (publicState) consulted.push("PUBLIC_STATE");
      else unavailable.push("CURRENT_PUBLIC_STATE");
      if (visualState) consulted.push("VISUAL_STATE");
      else unavailable.push("CURRENT_VISUAL_STATE");
      const incidentState = optionalJson(join(stateDir, "incidents",
        "incident-state.json"));
      if (Array.isArray(incidentState?.incidents))
        consulted.push("ATLAS_INCIDENT_HISTORY");
      else unavailable.push("ATLAS_INCIDENT_HISTORY");
      const filter = studioFilter(studio);
      const active = [...(publicState?.issues ?? []),
        ...(visualState?.issues ?? [])]
        .filter((item) => /^[A-Z][A-Z0-9_]{2,79}$/.test(item?.code ?? ""))
        .map(safeAnomaly).filter((item) => !filter ||
          item.studioCode === filter).slice(0, 5);
      const publicDiagnosis = diagnosePublic({ monitoring: {
        agent: "sentinela", runId: randomUUID(), anomalies: active }, now });
      let cloudFindings = [];
      if (!filter && currentReport) {
        const report = diagnoseSentinela({ sourceReport: currentReport, now });
        cloudFindings = report.findings.map((item) => ({
          studioCode: "GLOBAL", code: item.code,
          causeStatus: item.causeStatus, affected: item.affected,
          scope: "CLOUDFLARE" }));
      } else if (!filter && validEntry) {
        const fromJournal = (Array.isArray(entry.eventCodes)
          ? entry.eventCodes : [])
          .map((value) => /^(?:NEW|CHANGED|PERSISTENT):([A-Z][A-Z0-9_]{2,79})$/.exec(value))
          .filter(Boolean).map((match) => match[1]);
        const fromIncidents = (Array.isArray(incidentState?.incidents)
          ? incidentState.incidents : [])
          .filter((item) => item.state === "OPEN" &&
            item.lastObservedMonitorId === entry.monitorId &&
            /^[A-Z][A-Z0-9_]{2,79}$/.test(item.code ?? ""))
          .map((item) => item.code);
        cloudFindings = [...new Set([...fromJournal, ...fromIncidents])]
          .slice(0, 5).map((code) => ({ studioCode: "GLOBAL", code,
            causeStatus: "NAO_DETERMINADA",
            affected: ["monitorizacao-cloudflare"], scope: "CLOUDFLARE" }));
      }
      const findings = [...cloudFindings, ...publicDiagnosis.findings].slice(0, 8);
      const sourceRunIds = [currentReport?.runId,
        active.length && publicState ? entry?.publicRunId : null,
        active.length && visualState ? entry?.visualRunId : null]
        .filter((id) => UUID.test(id ?? ""));
      const status = !validEntry || !currentReport ||
        entry.overallStatus === "INDETERMINADO" ? "INDETERMINADO" :
        findings.length ? "DIAGNOSTICADO" : "SEM_ANOMALIAS";
      const reason = !validEntry ? "MONITOR_JOURNAL_UNAVAILABLE" :
        !currentReport ? "CURRENT_SENTINELA_REPORT_MISSING" :
          entry.overallStatus === "INDETERMINADO" ?
            "MONITOR_INDETERMINATE" : null;
      const diagnosis = { agent: "sherlock", runId: randomUUID(),
        observedAt: now().toISOString(), status, findings,
        sourceObservedAt: validEntry ? entry.at : null,
        sourceRunIds, sourcesConsulted: consulted,
        sourcesUnavailable: unavailable, reason };
      const stored = { diagnosis, source: validEntry ? "MONITOR_HISTORY" :
        "INDISPONIVEL", at: now().toISOString() };
      writeArtifact(stateDir, "diagnosis.json", stored);
      if (UUID.test(taskId ?? "")) {
        writeArtifact(stateDir, `diagnosis-${taskId}.json`, stored);
        pruneTaskDiagnoses(stateDir);
      }
      return { source: stored.source, status,
        observedAt: validEntry ? entry.at : null,
        monitorId: validEntry ? entry.monitorId : null,
        evidenceRunIds: sourceRunIds,
        sourcesConsulted: consulted, sourcesUnavailable: unavailable,
        historicalCodes: (priorReport?.anomalies ?? [])
          .map((item) => item.code).filter((code) =>
            /^[A-Z][A-Z0-9_]{2,79}$/.test(code)).slice(0, 4),
        reason, findings: diagnosis.findings.map((item) => ({
          studioCode: item.studioCode, code: item.code,
          affected: item.affected, causeStatus: item.causeStatus,
        })) };
    },
    inspect_code_context({ codes = [] } = {}) {
      if (!Array.isArray(codes) || codes.length > 5 ||
          codes.some((code) => !/^[A-Z0-9_]{3,80}$/.test(code)))
        throw new Error("CODE_CONTEXT_DENIED");
      return codeContext(codes);
    },
    prepare_patch_workspace({ taskId, proof } = {}) {
      return prepareReferencePatchWorkspace({ repositoryRoot: sourceRoot,
        parentDir: join(stateDir, "patch-worktrees"), taskId, proof });
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
    prepare_investigation({ dependencyId = null, taskId = null } = {}) {
      const evidence = artifact(stateDir, UUID.test(dependencyId ?? "")
        ? `diagnosis-${dependencyId}.json` : "diagnosis.json");
      if (!evidence) {
        const incidents = dependencyId ? null : optionalJson(join(stateDir,
          "incidents", "incident-state.json"));
        const last = (Array.isArray(incidents?.incidents) ? incidents.incidents : [])
          .filter((item) =>
          item.state === "OPEN" && item.steps?.sherlock).at(-1);
        return { source: last ? "INCIDENT_HISTORY" : "INDISPONIVEL",
          status: "BLOQUEADO", applied: false,
          findings: last ? [{ code: last.code,
            causeStatus: "NAO_DETERMINADA" }] : [],
          sourcesConsulted: last ? ["ATLAS_INCIDENT_HISTORY"] : [],
          sourcesUnavailable: ["SHERLOCK_TASK_DIAGNOSIS"],
          reason: "DIAGNOSIS_ARTIFACT_UNAVAILABLE" };
      }
      const consulted = ["SHERLOCK_TASK_DIAGNOSIS",
        ...(Array.isArray(evidence.diagnosis?.sourcesConsulted)
          ? evidence.diagnosis.sourcesConsulted : [])];
      const unavailable = Array.isArray(evidence.diagnosis?.sourcesUnavailable)
        ? evidence.diagnosis.sourcesUnavailable : [];
      if (!Number.isFinite(Date.parse(evidence.at)) ||
          now().getTime() - Date.parse(evidence.at) > 24 * 60 * 60_000)
        return { source: "SHERLOCK_TASK_DIAGNOSIS", status: "BLOQUEADO",
          applied: false, sourcesConsulted: consulted,
          sourcesUnavailable: [...unavailable, "FRESH_DIAGNOSIS"],
          reason: "DIAGNOSIS_STALE" };
      const findings = Array.isArray(evidence.diagnosis?.findings)
        ? evidence.diagnosis.findings : [];
      if (evidence.diagnosis?.status === "INDETERMINADO" ||
          !findings.length || findings.some((item) =>
            item.causeStatus !== "CONFIRMADA")) {
        const result = { source: "SHERLOCK_TASK_DIAGNOSIS",
          status: "BLOQUEADO", applied: false,
          observedAt: evidence.diagnosis.sourceObservedAt ?? evidence.at,
          findings: findings.map((item) => ({ code: item.code,
            causeStatus: item.causeStatus })),
          evidenceRunIds: evidence.diagnosis?.sourceRunIds ?? [],
          sourcesConsulted: consulted, sourcesUnavailable: unavailable,
          reason: "CAUSE_NOT_PROVEN" };
        if (UUID.test(taskId ?? ""))
          writeArtifact(stateDir, `proposal-${taskId}.json`, result);
        return result;
      }
      const proposal = planPublicCorrection({ diagnosis: evidence.diagnosis, now });
      proposal.runId = randomUUID();
      writeArtifact(stateDir, "proposal.json", { ...evidence, proposal,
        at: now().toISOString() });
      return { source: evidence.source, status: proposal.status,
        plan: proposal.plan?.action ?? null, scope: proposal.plan?.scope ?? [],
        proposedPatch: null, applied: false,
        observedAt: evidence.diagnosis.sourceObservedAt ?? evidence.at,
        findings: findings.map((item) => ({ code: item.code,
          causeStatus: item.causeStatus })),
        sourcesConsulted: consulted, sourcesUnavailable: unavailable,
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
