// Read-only Cloudflare configuration check. Never records binding values.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import JSON5 from "../../node_modules/json5/lib/index.js";
import { inspectReadOnlyOAuth } from "../agents/monitor-auth.mjs";
import { readOAuthToken } from "../agents/transport.mjs";

const auth = inspectReadOnlyOAuth();
if (auth.status !== "READ_ONLY_SCOPES" || Date.parse(auth.expiration) <= Date.now()) throw new Error("READ_ONLY_OAUTH_UNAVAILABLE");
const base = "https://api.cloudflare.com/client/v4/accounts/5c4cb61495df81feda4da7d1098e098e/workers/scripts/tanstack-start-app";
async function get(path) {
  const response = await fetch(base + path, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${readOAuthToken()}` } });
  if (!response.ok) throw new Error(`CLOUDFLARE_GET_${response.status}`);
  const data = await response.json();
  if (!data?.success) throw new Error("CLOUDFLARE_INVALID_RESPONSE");
  return data.result;
}
const deployments = await get("/deployments");
const active = (deployments.deployments?.[0]?.versions ?? []).filter((v) => v.percentage === 100);
if (active.length !== 1) throw new Error("ACTIVE_TRAFFIC_AMBIGUOUS");
const versionId = active[0].version_id;
const version = await get(`/versions/${versionId}`);
const schedules = await get("/schedules");
const normalize = (xs) => xs.map((v) => `${v.type}:${v.name}`).sort();
const bindings = normalize((version.resources?.bindings ?? []).map(({ name, type }) => ({ name, type })));
const crons = (schedules.schedules ?? schedules).map((v) => v.cron).sort();
const runtime = version.resources?.script_runtime ?? {};
const candidates = {};
for (const file of ["wrangler.jsonc", "wrangler.production.jsonc"]) {
  const config = JSON5.parse(readFileSync(resolve(file), "utf8"));
  const env = config.env?.production ?? {};
  const candidatePlain = Object.keys(env.vars ?? {}).map((name) => `plain_text:${name}`).sort();
  candidates[file] = { keepVars: config.keep_vars, crons: (env.triggers?.crons ?? []).sort(),
    runtime: { date: config.compatibility_date, flags: config.compatibility_flags },
    declaredPlainNames: candidatePlain.map((v) => v.slice(11)),
    missingFromActive: candidatePlain.filter((v) => !bindings.includes(v)),
    activePlainNotDeclared: bindings.filter((v) => v.startsWith("plain_text:") && !candidatePlain.includes(v)),
  };
}
const result = { activeVersion: versionId, activeBindingCount: bindings.length, activeBindingNamesTypes: bindings,
  crons, runtime: { compatibility_date: runtime.compatibility_date, compatibility_flags: runtime.compatibility_flags }, candidates };
writeFileSync(resolve(`.bellza-agent-state/production-reference/${versionId}.config.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ activeVersion: versionId, activeBindingCount: bindings.length, crons,
  runtime: result.runtime, candidates: Object.fromEntries(Object.entries(candidates).map(([name, c]) => [name, {
    keepVars: c.keepVars, crons: c.crons, declaredPlainCount: c.declaredPlainNames.length,
    missingFromActive: c.missingFromActive, activePlainNotDeclared: c.activePlainNotDeclared,
  }])) }, null, 2));
