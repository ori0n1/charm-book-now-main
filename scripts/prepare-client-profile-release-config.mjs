// Read-only OAuth preflight. Creates a local ignored upload config; never deploys.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const official = JSON.parse(readFileSync("OFFICIAL_BASE.json", "utf8"));
const source = JSON.parse(readFileSync("wrangler.production.jsonc", "utf8"));
const token = readFileSync(join(process.env.APPDATA ?? "", "xdg.config", ".wrangler", "config", "default.toml"), "utf8")
  .match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error("cloudflare_oauth_unavailable");

const worker = official.worker;
const root = `https://api.cloudflare.com/client/v4/accounts/${official.cloudflareAccountId}`;
async function get(path) {
  const response = await fetch(root + path, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`cloudflare_read_failed:${path}:${response.status}`);
  return body.result;
}

const script = `/workers/scripts/${worker}`;
const [deployments, settings, schedules, domains, version] = await Promise.all([
  get(`${script}/deployments`), get(`${script}/settings`), get(`${script}/schedules`),
  get("/workers/domains"), get(`${script}/versions/${official.cloudflareVersionId}`),
]);
const active = deployments.deployments?.[0]?.versions?.find((item) => item.percentage === 100);
if (active?.version_id !== official.cloudflareVersionId || version?.id !== official.cloudflareVersionId) {
  throw new Error("active_worker_version_changed");
}
const bindings = settings.bindings ?? [];
const versionBindings = version.resources?.bindings ?? [];
const signature = (items) => items.map((item) => ({
  name: item.name, type: item.type, text: item.type === "plain_text" ? item.text : undefined,
})).sort((a, b) => a.name.localeCompare(b.name));
if (JSON.stringify(signature(bindings)) !== JSON.stringify(signature(versionBindings))) {
  throw new Error("active_version_binding_mismatch");
}
const plain = bindings.filter((item) => item.type === "plain_text");
const secrets = bindings.filter((item) => item.type === "secret_text").map((item) => item.name).sort();
if (bindings.length !== official.productionBindings.total || secrets.length !== official.productionBindings.secrets) {
  throw new Error("production_binding_types_changed");
}
const vars = Object.fromEntries(plain.map((item) => [item.name, item.text]));
for (const [name, value] of Object.entries(source.env.production.vars)) {
  if (vars[name] !== value) throw new Error(`production_plain_var_drift:${name}`);
}
const extras = official.productionBindings.additionalPlainNames;
if (extras.some((name) => !(name in vars))) throw new Error("additional_production_vars_changed");
const cron = (schedules.schedules ?? []).map((item) => item.cron).sort();
const hostnames = (Array.isArray(domains) ? domains : []).filter((item) => item.service === worker)
  .map((item) => item.hostname).sort();
if (JSON.stringify(cron) !== JSON.stringify(official.cron.slice().sort()) ||
  JSON.stringify(hostnames) !== JSON.stringify(official.domains.slice().sort())) {
  throw new Error("production_cron_or_domains_changed");
}
const runtime = version.resources?.script_runtime;
if (runtime?.compatibility_date !== source.compatibility_date ||
  JSON.stringify(runtime.compatibility_flags?.slice().sort()) !== JSON.stringify(source.compatibility_flags.slice().sort())) {
  throw new Error("production_runtime_changed");
}
const config = {
  name: worker, main: "index.js", assets: { directory: "../client" },
  no_bundle: true, rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
  workers_dev: false, preview_urls: false, keep_vars: true,
  compatibility_date: runtime.compatibility_date, compatibility_flags: runtime.compatibility_flags,
  triggers: { crons: cron }, vars, secrets: { required: secrets },
};
const path = "dist/server/wrangler.client-profile.production.json";
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
console.log(JSON.stringify({
  activeVersion: official.cloudflareVersionId, bindings: bindings.length, plain: plain.length,
  secrets: secrets.length, additionalPlainNames: extras, cron, domains: hostnames,
  runtime: { date: runtime.compatibility_date, flags: runtime.compatibility_flags },
  configPath: path, configSha256: hash, noProductionMutation: true,
}));
