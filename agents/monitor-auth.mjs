import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const ALLOWED_SCOPES = new Set(["account:read", "user:read", "workers_tail:read", "offline_access"]);
const REQUIRED_SCOPES = ["account:read", "user:read", "workers_tail:read", "offline_access"];

export function inspectReadOnlyOAuth({
  appData = process.env.APPDATA,
  readFile = readFileSync,
} = {}) {
  if (!appData) return { status: "AUTH_UNAVAILABLE" };
  let config;
  try {
    config = readFile(join(appData, "xdg.config", ".wrangler", "config", "default.toml"), "utf8");
  } catch {
    return { status: "AUTH_UNAVAILABLE" };
  }
  // Never return token or refresh-token values, including in errors.
  const hasToken = /^\s*oauth_token\s*=\s*"[^"]+"/m.test(config);
  const hasRefresh = /^\s*refresh_token\s*=\s*"[^"]+"/m.test(config);
  const scopeLine = config.match(/^\s*scopes\s*=\s*\[([^\]\r\n]*)\]/m)?.[1];
  const scopes = scopeLine ? [...scopeLine.matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];
  const scopeSyntaxValid = scopeLine &&
    scopeLine.replace(/"[^"]+"/g, "").replace(/[\s,]/g, "") === "";
  if (!scopeSyntaxValid || !scopes.length || new Set(scopes).size !== scopes.length ||
      scopes.some((scope) => !ALLOWED_SCOPES.has(scope)) ||
      REQUIRED_SCOPES.some((scope) => !scopes.includes(scope))) {
    return { status: "AUTH_SCOPE_UNSAFE" };
  }
  if (!hasToken || !hasRefresh) return { status: "AUTH_UNAVAILABLE" };
  const expiration = config.match(/^\s*expiration_time\s*=\s*"([^"]+)"/m)?.[1];
  if (!Number.isFinite(Date.parse(expiration ?? ""))) return { status: "AUTH_UNAVAILABLE" };
  return { status: "READ_ONLY_SCOPES", expiration };
}

function runWranglerWhoami() {
  let cli;
  try { cli = require.resolve("wrangler"); } catch { return false; }
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^CLOUDFLARE_(?:API_TOKEN|API_KEY|EMAIL)$|^CF_API_(?:TOKEN|KEY)$/.test(name)) {
      delete env[name];
    }
  }
  const result = spawnSync(process.execPath, [cli, "whoami"], {
    env, stdio: "ignore", windowsHide: true, timeout: 20_000,
  });
  return result.status === 0 && !result.error;
}

export function verifyNoninteractiveReadOnlyOAuth({
  inspect = inspectReadOnlyOAuth,
  whoami = runWranglerWhoami,
  now = () => new Date(),
} = {}) {
  const before = inspect();
  if (before.status !== "READ_ONLY_SCOPES") return { status: before.status };
  const needsRefresh = Date.parse(before.expiration) <=
    now().getTime() + 5 * 60_000;
  if (!whoami()) return { status: needsRefresh ?
    "AUTH_REFRESH_UNAVAILABLE" : "AUTH_CHECK_UNAVAILABLE" };
  const after = inspect();
  if (after.status !== "READ_ONLY_SCOPES") return { status: after.status };
  if (Date.parse(after.expiration) <= now().getTime() + 5 * 60_000) {
    return { status: "AUTH_EXPIRED" };
  }
  return { status: "READY", authSource: "WRANGLER_OAUTH_READ_ONLY" };
}
