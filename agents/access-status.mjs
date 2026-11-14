import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { inspectReadOnlyOAuth } from "./monitor-auth.mjs";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function json(path) {
  if (statSync(path).size > 2_000_000) throw new Error("ACCESS_STATE_TOO_LARGE");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function assessLocalAccess({ monitorStateDir, oauth,
  now = new Date(), read = json } = {}) {
  const result = { cloudflare: { status: "INDETERMINADO",
    reason: "NO_RECENT_VALID_REPORT", observedAt: null },
    supabase: { status: "BLOQUEADO", reason: "NO_VERIFIED_RLS_READ_ROLE" },
    stripe: { status: "BLOQUEADO", reason: "NO_VERIFIED_READ_ACCESS" } };
  if (oauth?.status !== "READ_ONLY_SCOPES") {
    result.cloudflare.reason = oauth?.status ?? "AUTH_UNAVAILABLE";
    return result;
  }
  const expiration = Date.parse(oauth.expiration);
  if (!Number.isFinite(expiration) || expiration <= now.getTime() + 5 * 60_000) {
    result.cloudflare.reason = "AUTH_REFRESH_NEEDED";
    return result;
  }
  try {
    const state = read(join(monitorStateDir, "monitor-state.json"));
    const latest = state?.journal?.at(-1);
    if (latest?.mode !== "LIVE_READ_ONLY" ||
        !UUID.test(latest.sentinelaRunId ?? "") ||
        !Number.isFinite(Date.parse(latest.at ?? ""))) return result;
    result.cloudflare.observedAt = latest.at;
    const age = now.getTime() - Date.parse(latest.at);
    if (age < 0 || age > 60 * 60_000) {
      result.cloudflare.reason = "LAST_REPORT_STALE";
      return result;
    }
    const report = read(join(monitorStateDir, "runs",
      `${latest.sentinelaRunId}.json`));
    if (report?.agent !== "sentinela" ||
        report.runId !== latest.sentinelaRunId) return result;
    const blocked = report.checks?.find((item) =>
      item.name === "cloudflare_read" && item.status === "BLOCKED");
    if (blocked) {
      result.cloudflare.reason = /^[A-Z_]{3,60}$/.test(blocked.reason ?? "")
        ? blocked.reason : "CLOUDFLARE_READ_FAILED";
      return result;
    }
    if (!UUID.test(report.observed?.activeVersion ?? "")) return result;
    result.cloudflare.status = "OPERACIONAL_RECENTE";
    result.cloudflare.reason = "READ_ONLY_REPORT_VERIFIED";
  } catch { /* Missing or corrupt local evidence remains indeterminate. */ }
  return result;
}

export function localAccessStatus({ localAppData = process.env.LOCALAPPDATA,
  now = new Date() } = {}) {
  const oauth = inspectReadOnlyOAuth();
  if (!localAppData) return assessLocalAccess({ oauth, now });
  try {
    const config = json(join(localAppData, "Bellza", "TelegramGateway",
      "config.json"));
    if (typeof config.monitorStateDir !== "string")
      throw new Error("MONITOR_PATH_UNAVAILABLE");
    return assessLocalAccess({ monitorStateDir: config.monitorStateDir,
      oauth, now });
  } catch {
    return assessLocalAccess({ oauth, now });
  }
}
