import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_FILE_BYTES = 4_000_000;
function readJson(path) {
  if (statSync(path).size > MAX_FILE_BYTES) throw new Error("INCIDENT_SOURCE_TOO_LARGE");
  return JSON.parse(readFileSync(path, "utf8"));
}
function optionalJson(path) {
  try { return readJson(path); } catch { return null; }
}
function runJson(base, id) {
  return UUID.test(id ?? "") ? optionalJson(join(base, `${id}.json`)) : null;
}
function detailHash(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null))
    .digest("hex").slice(0, 24);
}
function matchAlert(items, flowId, alert) {
  return (items ?? []).find((item) => item.flowId === flowId &&
    item.kind === alert.kind && item.code === alert.code &&
    (!alert.evidence?.path || item.path === alert.evidence.path)) ?? null;
}
function activeFrom(report, source) {
  return (report?.anomalies ?? []).filter((item) =>
    typeof item?.code === "string" &&
    ["critical", "warning", "info", "blocked"].includes(item.severity))
    .map((item) => ({ code: item.code,
      severity: item.severity === "blocked" ? "warning" : item.severity,
      studioCode: source === "cloudflare" ? "GLOBAL" : item.studioCode,
      path: item.path ?? item.evidence?.path ?? null,
      evidence: { source, httpStatus: item.evidence?.httpStatus ??
        item.httpStatus ?? null, viewport: item.viewport ?? null } }));
}

// Only local monitor artifacts are read. Source reports stay in memory;
// the coordinator persists a small allowlisted summary per incident.
export function readIncidentSource(monitorStateDir) {
  let monitor;
  try { monitor = readJson(join(monitorStateDir, "monitor-state.json")); }
  catch { throw new Error("INCIDENT_SOURCE_UNAVAILABLE"); }
  if (monitor?.schema !== 1 || !Array.isArray(monitor.journal) ||
      !Array.isArray(monitor.alerts) || monitor.journal.length > 1440 ||
      monitor.alerts.length > 1440) throw new Error("INCIDENT_SOURCE_INVALID");
  const latest = monitor.journal.at(-1);
  if (!UUID.test(latest?.monitorId ?? "") ||
      latest.mode !== "LIVE_READ_ONLY" ||
      !Number.isFinite(Date.parse(latest.at ?? "")))
    throw new Error("INCIDENT_LIVE_SOURCE_UNAVAILABLE");
  const byId = new Map(monitor.journal.filter((entry) =>
    UUID.test(entry.monitorId ?? "") && entry.mode === "LIVE_READ_ONLY")
    .map((entry) => [entry.monitorId, entry]));
  const publicState = optionalJson(join(monitorStateDir, "public-integrated",
    "public-state.json"));
  const visualState = optionalJson(join(monitorStateDir, "visual-prepared",
    "visual-state.json"));
  const reports = new Map();
  const publicReports = new Map();
  const visualReports = new Map();
  function pageReport(kind, id) {
    const cache = kind === "public" ? publicReports : visualReports;
    if (!cache.has(id)) {
      const dir = kind === "public" ? join(monitorStateDir,
        "public-integrated", "public-runs") : join(monitorStateDir,
        "visual-prepared", "visual-runs");
      const report = runJson(dir, id);
      cache.set(id, report?.mode === (kind === "public"
        ? "PUBLIC_READ_ONLY" : "PUBLIC_VISUAL_READ_ONLY") ? report : null);
    }
    return cache.get(id);
  }
  function reportFor(monitorId) {
    const entry = byId.get(monitorId);
    if (!entry) return null;
    if (!reports.has(monitorId)) {
      const report = runJson(join(monitorStateDir, "runs"), entry.sentinelaRunId);
      reports.set(monitorId, report?.agent === "sentinela" &&
        report.runId === entry.sentinelaRunId ? report : null);
    }
    return reports.get(monitorId);
  }
  const events = monitor.alerts.flatMap((alert) => {
    const entry = byId.get(alert?.monitorId);
    if (!entry || alert.sentinelaRunId !== entry.sentinelaRunId ||
        alert.at !== entry.at) return [];
    const pub = matchAlert(publicState?.alerts, entry.publicRunId, alert);
    const visual = pub ? null : matchAlert(visualState?.alerts,
      entry.visualRunId, alert);
    const match = pub ?? visual;
    const source = pub ? "public" : visual ? "visual" : "cloudflare";
    const report = pub ? pageReport("public", entry.publicRunId) :
      visual ? pageReport("visual", entry.visualRunId) : null;
    const page = report?.pages?.find((item) => item.path === match?.path &&
      (!match?.viewport || item.viewport === match.viewport));
    return [{ monitorId: entry.monitorId,
      sourceRunId: entry.sentinelaRunId,
      kind: alert.kind, code: alert.code, severity: alert.severity,
      observedAt: entry.at, studioCode: match?.studioCode ??
        (alert.evidence?.path ? "UNKNOWN" : "GLOBAL"),
      path: match?.path ?? alert.evidence?.path ?? null,
      changeHash: alert.kind === "CHANGED" ? detailHash(alert.evidence) : null,
      evidence: { source, httpStatus: alert.evidence?.httpStatus ??
        page?.httpStatus ?? null,
        viewport: match?.viewport ?? null } }];
  });
  const sentinela = reportFor(latest.monitorId);
  const publicReport = pageReport("public", latest.publicRunId);
  const visualReport = pageReport("visual", latest.visualRunId);
  const active = [
    ...activeFrom(sentinela, "cloudflare"),
    ...(publicReport?.mode === "PUBLIC_READ_ONLY"
      ? activeFrom(publicReport, "public") : []),
    ...(visualReport?.mode === "PUBLIC_VISUAL_READ_ONLY"
      ? activeFrom(visualReport, "visual") : []),
  ];
  return { mode: "LIVE_READ_ONLY", events, active,
    latest: { monitorId: latest.monitorId, observedAt: latest.at }, reportFor };
}
