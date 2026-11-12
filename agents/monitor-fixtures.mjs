const OFFICIAL = "11111111-1111-4111-8111-111111111111";
const ACTIVE = "22222222-2222-4222-8222-222222222222";
const CHANGED = "33333333-3333-4333-8333-333333333333";

export function syntheticMonitorReport(scenario, { runId, now = () => new Date() } = {}) {
  if (!["baseline", "version-change", "metadata-change", "outage", "auth-unavailable", "recovery"].includes(scenario)) {
    throw new Error("INVALID_MONITOR_SCENARIO");
  }
  const authBlocked = scenario === "auth-unavailable";
  const version = scenario === "version-change" ? CHANGED : ACTIVE;
  const outage = scenario === "outage";
  const metadataChange = scenario === "metadata-change";
  const checks = authBlocked
    ? [{ name: "cloudflare_read", status: "BLOCKED", reason: "AUTH_UNAVAILABLE" }]
    : ["cloudflare_traffic", "bindings", "runtime", "script_settings", "crons"]
      .map((name) => ({ name, status: metadataChange &&
        ["bindings", "runtime", "crons"].includes(name) ? "FAILED" : "PASS" }));
  checks.push({ name: "public_endpoint", path: "/", status: "PASS", httpStatus: 200 });
  checks.push({ name: "public_endpoint", path: "/login", status: outage ? "FAILED" : "PASS",
    httpStatus: outage ? 503 : 200 });
  const anomalies = authBlocked
    ? [{ code: "AUTH_UNAVAILABLE", severity: "blocked" }]
    : scenario === "version-change" ? []
      : [{ code: "OFFICIAL_RECORD_OUTDATED", severity: "warning" }];
  if (scenario === "version-change") anomalies.push({ code: "REFERENCE_OUTDATED", severity: "warning" });
  if (metadataChange) anomalies.push(
    { code: "BINDINGS_DIVERGENCE_CONFIRMED", severity: "critical" },
    { code: "RUNTIME_DIVERGENCE_CONFIRMED", severity: "critical" },
    { code: "CRONS_DIVERGENCE_CONFIRMED", severity: "critical" },
  );
  if (outage) anomalies.push({ code: "PUBLIC_ENDPOINT_UNAVAILABLE", severity: "warning" });
  return {
    agent: "sentinela", runId, observedAt: now().toISOString(),
    status: authBlocked ? "INDETERMINADO" : metadataChange ? "ALERTA" : anomalies.length ? "ATENCAO" : "OK",
    reference: { observedVersion: ACTIVE, officialRecordedVersion: OFFICIAL },
    observed: { activeVersion: authBlocked ? null : version,
      bindings: authBlocked ? null : [metadataChange ? "APP_URL:secret_text" : "APP_URL:plain_text"],
      bindingDiff: authBlocked ? null : metadataChange
        ? { missing: ["APP_URL:plain_text"], unexpected: ["APP_URL:secret_text"] }
        : { missing: [], unexpected: [] },
      runtime: authBlocked ? null : { compatibility_date: metadataChange ? "2025-02-01" : "2025-01-01",
        compatibility_flags: ["nodejs_compat"], usage_model: "standard" },
      crons: authBlocked ? null : [metadataChange ? "*/15 * * * *" : "*/30 * * * *"] },
    checks, anomalies,
  };
}
