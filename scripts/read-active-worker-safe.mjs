import { readFileSync } from "node:fs";
import { join } from "node:path";

const account = "5c4cb61495df81feda4da7d1098e098e";
const worker = "tanstack-start-app";
const tokenPath = join(process.env.APPDATA ?? "", "xdg.config", ".wrangler", "config", "default.toml");
const token = readFileSync(tokenPath, "utf8").match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error("Cloudflare OAuth session unavailable");

async function read(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`Cloudflare read failed: HTTP ${response.status}`);
  return body.result;
}

const [deployments, settings, schedules, domains] = await Promise.all([
  read(`/workers/scripts/${worker}/deployments`),
  read(`/workers/scripts/${worker}/settings`),
  read(`/workers/scripts/${worker}/schedules`),
  read("/workers/domains"),
]);
const candidate = JSON.parse(readFileSync(join(import.meta.dirname, "../dist/server/wrangler.public-mobile-auth.json"), "utf8"));
const active = deployments.deployments?.[0]?.versions?.find((version) => version.percentage === 100);
const bindings = settings.bindings ?? [];
const remotePlain = Object.fromEntries(bindings.filter((binding) => binding.type === "plain_text")
  .map((binding) => [binding.name, binding.text]));
const remoteSecretNames = bindings.filter((binding) => binding.type === "secret_text")
  .map((binding) => binding.name).sort();
const candidatePlain = candidate.vars ?? {};
console.log(JSON.stringify({
  activeVersion: active?.version_id ?? null,
  activePercentage: active?.percentage ?? null,
  bindingCount: bindings.length,
  plainCount: Object.keys(remotePlain).length,
  secretCount: remoteSecretNames.length,
  secretNames: remoteSecretNames,
  candidatePlainMismatchNames: Object.keys(candidatePlain).filter((name) => remotePlain[name] !== candidatePlain[name]),
  remotePlainNotInCandidate: Object.keys(remotePlain).filter((name) => !(name in candidatePlain)),
  keepVars: candidate.keep_vars === true,
  compatibilityDateMatches: settings.compatibility_date === candidate.compatibility_date,
  compatibilityFlagsMatch: JSON.stringify([...settings.compatibility_flags].sort()) === JSON.stringify([...candidate.compatibility_flags].sort()),
  activeCrons: (schedules.schedules ?? []).map((schedule) => schedule.cron).sort(),
  candidateCrons: candidate.triggers.crons,
  activeDomains: (Array.isArray(domains) ? domains : []).filter((domain) => domain.service === worker)
    .map((domain) => domain.hostname).sort(),
  candidateDomains: candidate.routes.map((route) => route.pattern).sort(),
}, null, 2));
