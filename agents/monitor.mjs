import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync,
  unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_STATE_DIR, runAtlas } from "./atlas.mjs";
import { analyzeMonitorRun } from "./monitor-analysis.mjs";
import { verifyNoninteractiveReadOnlyOAuth } from "./monitor-auth.mjs";
import { syntheticMonitorReport } from "./monitor-fixtures.mjs";

const configPath = fileURLToPath(new URL("./monitor-config.json", import.meta.url));
export const MONITOR_CONFIG = Object.freeze(JSON.parse(readFileSync(configPath, "utf8")));
if (MONITOR_CONFIG.schema !== 1 || MONITOR_CONFIG.scheduleEnabled !== false ||
    MONITOR_CONFIG.externalNotifications !== false ||
    MONITOR_CONFIG.plannedIntervalMinutes !== 30 ||
    MONITOR_CONFIG.maxCloudflareRequests !== 4 || MONITOR_CONFIG.maxPublicRequests !== 2 ||
    MONITOR_CONFIG.maxDurationMs !== 120_000 ||
    MONITOR_CONFIG.maxJournalEntries < 1 || MONITOR_CONFIG.maxJournalEntries > 1440 ||
    MONITOR_CONFIG.maxAlertsPerRun < 1 || MONITOR_CONFIG.maxAlertsPerRun > 12 ||
    !MONITOR_CONFIG.knownIssueCodes?.includes("OFFICIAL_RECORD_OUTDATED")) {
  throw new Error("UNSAFE_MONITOR_CONFIG");
}

function acquireMonitorLock(stateDir, id, now) {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "monitor.lock");
  let fd;
  try { fd = openSync(path, "wx", 0o600); }
  catch (error) {
    if (error?.code === "EEXIST") throw new Error("MONITOR_CONFLICTING_RUN");
    throw new Error("MONITOR_STATE_UNAVAILABLE");
  }
  try { writeFileSync(fd, JSON.stringify({ id, pid: process.pid, startedAt: now().toISOString() })); }
  finally { closeSync(fd); }
  return () => {
    try {
      if (JSON.parse(readFileSync(path, "utf8")).id === id) unlinkSync(path);
    } catch { /* Uncertain locks remain for manual inspection. */ }
  };
}

function readState(stateDir) {
  const path = join(stateDir, "monitor-state.json");
  if (!existsSync(path)) return { schema: 1, last: null, journal: [], alerts: [] };
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("MONITOR_STATE_INVALID"); }
  if (state?.schema !== 1 || !Array.isArray(state.journal) || !Array.isArray(state.alerts) ||
      state.journal.length > MONITOR_CONFIG.maxJournalEntries ||
      state.alerts.length > MONITOR_CONFIG.maxJournalEntries ||
      (state.last !== null && (!state.last || !Array.isArray(state.last.issues)))) {
    throw new Error("MONITOR_STATE_INVALID");
  }
  return state;
}

function atomicWrite(path, contents) {
  const temporary = join(dirname(path), `.monitor-${randomUUID()}.tmp`);
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, path);
}

function pruneOldRunReports(stateDir, removed, retained) {
  const retainedIds = new Set(retained.map((item) => item.sentinelaRunId));
  let skipped = 0;
  for (const item of removed) {
    const id = item.sentinelaRunId;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id ?? "") ||
        retainedIds.has(id)) continue;
    const path = join(stateDir, "runs", `${id}.json`);
    if (!existsSync(path)) continue;
    try {
      const report = JSON.parse(readFileSync(path, "utf8"));
      if (report.agent !== "sentinela" || report.runId !== id) { skipped++; continue; }
      unlinkSync(path);
    } catch { skipped++; }
  }
  return skipped;
}

function blockedReport(authStatus, id, now) {
  return {
    agent: "sentinela", runId: id, observedAt: now().toISOString(),
    status: "INDETERMINADO", observed: { activeVersion: null,
      bindings: null, runtime: null, crons: null },
    checks: [{ name: "cloudflare_read", status: "BLOCKED", reason: authStatus }],
    anomalies: [{ code: authStatus, severity: "blocked" }],
  };
}

export function formatMonitorReport(report) {
  return [
    `# Monitorização Atlas — ${report.status}`, "",
    `Execução: ${report.monitorId}`, `Sentinela: ${report.sentinelaRunId}`,
    `Modo: ${report.mode}`, `Autenticação: ${report.authStatus}`,
    `Versão observada: ${report.activeVersion ?? "indisponível"}`,
    `Bindings observados: ${report.bindingCount ?? "indisponíveis"}`,
    `Retenção: ${report.retentionSkipped ? `${report.retentionSkipped} ficheiros antigos requerem revisão local` : "histórico dentro do limite"}`,
    "", "## Alertas locais novos ou recuperados", "",
    ...(report.events.length ? report.events.map((item) =>
      `- ${item.kind} ${item.severity}: ${item.code}${item.evidence ? ` ${JSON.stringify(item.evidence)}` : ""}${item.possibleCause ? `; hipótese: ${item.possibleCause}` : ""}`)
      : ["- Nenhum alerta novo."]),
    "", "## Pendências", "",
    ...(report.knownPending.length ? report.knownPending.map((item) => `- Conhecida, sem alerta repetido: ${item}`) : ["- Nenhuma pendência conhecida ativa."]),
    `- Total de problemas ativos: ${report.activeIssueCount}`,
    "", "Sem notificações externas, correções, alterações de configuração ou publicação.", "",
  ].join("\n");
}

export async function runMonitorOnce({
  stateDir = DEFAULT_STATE_DIR,
  mode = "live",
  scenario = "baseline",
  now = () => new Date(),
  authCheck = verifyNoninteractiveReadOnlyOAuth,
  collect,
} = {}) {
  if (!["live", "synthetic"].includes(mode)) throw new Error("INVALID_MONITOR_MODE");
  const monitorId = randomUUID();
  const release = acquireMonitorLock(stateDir, monitorId, now);
  try {
    const state = readState(stateDir);
    const auth = mode === "synthetic" ? { status: "SYNTHETIC_NO_NETWORK" } : authCheck();
    let source;
    if (mode === "live" && auth.status !== "READY") {
      const id = randomUUID();
      source = { id, report: blockedReport(auth.status, id, now) };
    } else if (collect) {
      source = await collect();
    } else if (mode === "synthetic") {
      const id = randomUUID();
      source = { id, report: syntheticMonitorReport(scenario, { runId: id, now }) };
    } else {
      source = await runAtlas({ agent: "sentinela", stateDir,
        maxDurationMs: MONITOR_CONFIG.maxDurationMs - 30_000 });
    }
    const reportWithId = { ...source.report, runId: source.id };
    const analysis = analyzeMonitorRun(reportWithId, state.last, MONITOR_CONFIG);
    const summary = {
      monitorId, sentinelaRunId: source.id, observedAt: now().toISOString(),
      mode: mode === "synthetic" ? "SYNTHETIC_SIMULATION" : "LIVE_READ_ONLY",
      authStatus: auth.status, status: reportWithId.status,
      activeVersion: analysis.observation.activeVersion,
      bindingCount: analysis.observation.bindingCount,
      events: analysis.events, omittedEvents: analysis.omittedEvents,
      knownPending: analysis.knownPending, activeIssueCount: analysis.issues.length,
      externalNotifications: false,
    };
    const entry = { monitorId, sentinelaRunId: source.id, at: summary.observedAt,
      mode: summary.mode, status: summary.status, issueKeys: analysis.issues.map((item) => item.key),
      eventCodes: analysis.events.map((item) => `${item.kind}:${item.code}`) };
    const journalAll = [...state.journal, entry];
    const removed = journalAll.slice(0, Math.max(0, journalAll.length - MONITOR_CONFIG.maxJournalEntries));
    const next = {
      schema: 1, last: analysis.nextSnapshot,
      journal: journalAll.slice(-MONITOR_CONFIG.maxJournalEntries),
      alerts: [...state.alerts, ...analysis.events.map((item) => ({
        monitorId, sentinelaRunId: source.id, at: summary.observedAt,
        kind: item.kind, code: item.code, severity: item.severity, evidence: item.evidence,
      }))].slice(-MONITOR_CONFIG.maxJournalEntries),
    };
    atomicWrite(join(stateDir, "monitor-state.json"), `${JSON.stringify(next, null, 2)}\n`);
    summary.retentionSkipped = pruneOldRunReports(stateDir, removed, next.journal);
    atomicWrite(join(stateDir, "latest-monitor.md"), formatMonitorReport(summary));
    return { ...summary, reportPath: join(stateDir, "latest-monitor.md") };
  } finally {
    release();
  }
}
