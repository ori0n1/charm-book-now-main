import { createHash } from "node:crypto";
import { diagnoseSentinela } from "./sherlock.mjs";

const VERSION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const CODE = /^[A-Z][A-Z0-9_]{2,60}$/;
const PATHS = ["/", "/login"];
const CRITICAL = new Set([
  "TRAFFIC_NOT_SINGLE_100", "BINDINGS_DIVERGENCE_CONFIRMED",
  "RUNTIME_DIVERGENCE_CONFIRMED", "CRONS_DIVERGENCE_CONFIRMED",
  "PUBLIC_ENDPOINT_UNAVAILABLE",
]);
const METADATA_CODES = {
  bindings: "BINDINGS_DIVERGENCE_CONFIRMED",
  runtime: "RUNTIME_DIVERGENCE_CONFIRMED",
  crons: "CRONS_DIVERGENCE_CONFIRMED",
};

function fingerprint(value) {
  return value == null ? null : createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function safeReport(report) {
  if (report?.agent !== "sentinela" || !VERSION.test(report.runId ?? "") ||
      !Number.isFinite(Date.parse(report.observedAt ?? "")) ||
      !["OK", "ATENCAO", "ALERTA", "INDETERMINADO"].includes(report.status) ||
      !Array.isArray(report.checks) || !Array.isArray(report.anomalies)) {
    throw new Error("INVALID_MONITOR_INPUT");
  }
  const checks = report.checks.map((item) => ({
    name: item.name, status: item.status, path: item.path ?? null,
    reason: item.reason ?? null, httpStatus: item.httpStatus ?? null,
  }));
  if (checks.length > 20 || checks.some((item) =>
    !["cloudflare_traffic", "bindings", "runtime", "script_settings", "crons",
      "cloudflare_read", "public_endpoint", "agent_process"].includes(item.name) ||
    !["PASS", "FAILED", "BLOCKED", "REVIEW"].includes(item.status) ||
    (item.path !== null && !PATHS.includes(item.path)) ||
    (item.reason !== null && !CODE.test(item.reason)) ||
    (item.httpStatus !== null && (!Number.isInteger(item.httpStatus) || item.httpStatus < 100 || item.httpStatus > 599)))) {
    throw new Error("INVALID_MONITOR_INPUT");
  }
  const anomalies = report.anomalies.map((item) => ({ code: item.code,
    severity: item.severity }));
  if (anomalies.length > 20 || anomalies.some((item) =>
    !CODE.test(item.code) || !["warning", "critical", "blocked"].includes(item.severity))) {
    throw new Error("INVALID_MONITOR_INPUT");
  }
  const activeVersion = report.observed?.activeVersion ?? null;
  if (activeVersion !== null && !VERSION.test(activeVersion)) throw new Error("INVALID_MONITOR_INPUT");
  const bindings = report.observed?.bindings ?? null;
  const rawBindingDiff = report.observed?.bindingDiff ?? null;
  const rawRuntime = report.observed?.runtime ?? null;
  const crons = report.observed?.crons ?? null;
  if (bindings !== null && (!Array.isArray(bindings) || bindings.length > 200 ||
      bindings.some((item) => !/^[A-Za-z0-9_.-]{1,128}:[A-Za-z0-9_]{1,60}$/.test(item)))) {
    throw new Error("INVALID_MONITOR_INPUT");
  }
  const safePairs = (items) => Array.isArray(items) && items.length <= 200 &&
    items.every((item) => typeof item === "string" &&
      /^[A-Za-z0-9_.-]{1,128}:[A-Za-z0-9_]{1,60}$/.test(item));
  if (rawBindingDiff !== null && (!safePairs(rawBindingDiff.missing) ||
      !safePairs(rawBindingDiff.unexpected))) throw new Error("INVALID_MONITOR_INPUT");
  if (crons !== null && (!Array.isArray(crons) || crons.length > 20 ||
      crons.some((item) => !/^[A-Za-z0-9*/?,#@L -]{1,100}$/.test(item)))) {
    throw new Error("INVALID_MONITOR_INPUT");
  }
  let runtime = null;
  if (rawRuntime !== null) {
    if (typeof rawRuntime !== "object" ||
        (rawRuntime.compatibility_date !== null &&
          !/^\d{4}-\d{2}-\d{2}$/.test(rawRuntime.compatibility_date)) ||
        !Array.isArray(rawRuntime.compatibility_flags) || rawRuntime.compatibility_flags.length > 20 ||
        rawRuntime.compatibility_flags.some((flag) => !/^[a-z0-9_]{1,50}$/.test(flag)) ||
        (rawRuntime.usage_model !== null && !/^[a-z_]{1,40}$/.test(rawRuntime.usage_model))) {
      throw new Error("INVALID_MONITOR_INPUT");
    }
    runtime = { compatibility_date: rawRuntime.compatibility_date,
      compatibility_flags: [...rawRuntime.compatibility_flags], usage_model: rawRuntime.usage_model };
  }
  return { runId: report.runId, observedAt: report.observedAt, status: report.status,
    checks, anomalies, activeVersion,
    bindingCount: bindings?.length ?? null,
    bindingDiff: rawBindingDiff === null ? null : {
      missing: [...rawBindingDiff.missing], unexpected: [...rawBindingDiff.unexpected],
    },
    runtime, crons: crons === null ? null : [...crons],
    fingerprints: { bindings: fingerprint(bindings), runtime: fingerprint(runtime), crons: fingerprint(crons) },
  };
}

function issue(key, code, domain, severity, evidence = null) {
  return { key, code, domain, severity, evidence };
}

function currentIssues(report) {
  const issues = new Map();
  for (const item of report.anomalies) {
    if (["PUBLIC_ENDPOINT_UNAVAILABLE", "PUBLIC_ENDPOINT_READ_BLOCKED"].includes(item.code)) continue;
    const blocked = ["AUTH_UNAVAILABLE", "AUTH_REJECTED", "NETWORK_UNAVAILABLE",
      "AUTH_SCOPE_UNSAFE", "AUTH_REFRESH_UNAVAILABLE", "AUTH_CHECK_UNAVAILABLE",
      "AUTH_EXPIRED", "CLOUDFLARE_RATE_LIMITED",
      "CLOUDFLARE_ENDPOINT_NOT_FOUND", "CLOUDFLARE_API_UNAVAILABLE",
      "CLOUDFLARE_READ_FAILED", "AGENT_PROCESS_FAILED"].includes(item.code);
    const key = blocked ? "CLOUDFLARE_READ_BLOCKED" : item.code;
    const evidence = item.code === "BINDINGS_DIVERGENCE_CONFIRMED" ? report.bindingDiff
      : item.code === "RUNTIME_DIVERGENCE_CONFIRMED" ? report.runtime
        : item.code === "CRONS_DIVERGENCE_CONFIRMED" ? { crons: report.crons }
          : item.code === "REFERENCE_OUTDATED" || item.code === "VERSION_DIVERGENCE_UNEXPLAINED"
            ? { activeVersion: report.activeVersion }
            : blocked ? { reason: item.code } : null;
    issues.set(key, issue(key, item.code, blocked ? "cloudflare_access" : "cloudflare",
      item.severity === "critical" || CRITICAL.has(item.code) ? "critical" : "warning", evidence));
  }
  for (const check of report.checks.filter((item) => item.name === "public_endpoint")) {
    if (check.status === "FAILED" || check.status === "BLOCKED") {
      const code = check.status === "FAILED" ? "PUBLIC_ENDPOINT_UNAVAILABLE" : "PUBLIC_ENDPOINT_READ_BLOCKED";
      const key = `${code}:${check.path}`;
      issues.set(key, issue(key, code, check.status === "FAILED" ? `public:${check.path}` : `public_read:${check.path}`,
        check.status === "FAILED" ? "critical" : "warning",
        { path: check.path, httpStatus: check.httpStatus, reason: check.reason }));
    }
  }
  return issues;
}

function observedDomain(previousIssue, report, cloudflareComplete) {
  if (previousIssue.domain.startsWith("public")) {
    const path = previousIssue.domain.split(":")[1];
    const check = report.checks.find((item) => item.name === "public_endpoint" && item.path === path);
    return previousIssue.domain.startsWith("public_read")
      ? check && ["PASS", "FAILED"].includes(check.status)
      : check?.status === "PASS";
  }
  return cloudflareComplete;
}

export function analyzeMonitorRun(sourceReport, previous = null, {
  knownIssueCodes = ["OFFICIAL_RECORD_OUTDATED"], maxAlertsPerRun = 12,
} = {}) {
  const report = safeReport(sourceReport);
  const previousIssues = new Map((previous?.issues ?? []).map((item) => [item.key, item]));
  const incoming = currentIssues(report);
  const nextIssues = new Map(previousIssues);
  const complete = ["cloudflare_traffic", "bindings", "runtime", "script_settings", "crons"]
    .every((name) => report.checks.some((item) => item.name === name &&
      ["PASS", "FAILED", "REVIEW"].includes(item.status))) &&
    !report.checks.some((item) => item.name === "cloudflare_read" && item.status === "BLOCKED");
  const known = new Set(knownIssueCodes);
  const events = [];
  const diagnosis = diagnoseSentinela({ sourceReport: { ...sourceReport,
    checks: report.checks, anomalies: report.anomalies } });
  const possibleCause = (code) => diagnosis.findings.find((item) => item.code === code)?.hypothesis ?? null;
  for (const old of previousIssues.values()) {
    if (incoming.has(old.key)) continue;
    if (observedDomain(old, report, complete)) {
      nextIssues.delete(old.key);
      if (!known.has(old.code)) events.push({ kind: "RECOVERED", code: old.code,
        key: old.key, severity: "info", evidence: old.evidence ?? null, possibleCause: null });
    }
  }
  for (const item of incoming.values()) {
    if (!previousIssues.has(item.key) && !known.has(item.code)) {
      events.push({ kind: "NEW", code: item.code, key: item.key,
        severity: item.severity, evidence: item.evidence, possibleCause: possibleCause(item.code) });
    }
    nextIssues.set(item.key, item);
  }
  if (previous?.activeVersion && report.activeVersion &&
      previous.activeVersion !== report.activeVersion &&
      !events.some((item) => item.code === "REFERENCE_OUTDATED" || item.code === "VERSION_DIVERGENCE_UNEXPLAINED")) {
    events.push({ kind: "CHANGED", code: "ACTIVE_VERSION_CHANGED", key: "ACTIVE_VERSION_CHANGED",
      severity: "warning", evidence: { from: previous.activeVersion, to: report.activeVersion }, possibleCause: null });
  }
  for (const [name, code] of Object.entries(METADATA_CODES)) {
    const before = previous?.fingerprints?.[name];
    const after = report.fingerprints[name];
    if (before && after && before !== after &&
        !events.some((item) => item.code === code)) {
      events.push({ kind: "CHANGED", code: `${name.toUpperCase()}_CHANGED`,
        key: `${name.toUpperCase()}_CHANGED`, severity: "warning",
        evidence: { previousFingerprint: before, currentFingerprint: after }, possibleCause: null });
    }
  }
  const limitedEvents = events.slice(0, maxAlertsPerRun);
  return {
    observation: report,
    issues: [...nextIssues.values()].sort((a, b) => a.key.localeCompare(b.key)),
    knownPending: [...nextIssues.values()].filter((item) => known.has(item.code)).map((item) => item.code),
    events: limitedEvents,
    omittedEvents: events.length - limitedEvents.length,
    nextSnapshot: {
      runId: report.runId, observedAt: report.observedAt,
      activeVersion: report.activeVersion ?? previous?.activeVersion ?? null,
      fingerprints: Object.fromEntries(Object.keys(report.fingerprints).map((name) =>
        [name, report.fingerprints[name] ?? previous?.fingerprints?.[name] ?? null])),
      issues: [...nextIssues.values()],
    },
  };
}
