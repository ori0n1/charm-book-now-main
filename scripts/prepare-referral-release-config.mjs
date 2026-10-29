// Read-only Cloudflare preflight. Writes a local config only; never uploads.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const worker = "tanstack-start-app";
const account = "5c4cb61495df81feda4da7d1098e098e";
const expectedVersion = "dcf02180-34eb-4b6b-919a-5efc038292a3";
const token = readFileSync(join(process.env.APPDATA ?? "", "xdg.config", ".wrangler", "config", "default.toml"), "utf8")
  .match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error("cloudflare_oauth_unavailable");

async function get(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`cloudflare_read_failed:${response.status}`);
  return body.result;
}

const [deployments, settings, schedules, domains, version] = await Promise.all([
  get(`/workers/scripts/${worker}/deployments`),
  get(`/workers/scripts/${worker}/settings`),
  get(`/workers/scripts/${worker}/schedules`),
  get("/workers/domains"),
  get(`/workers/scripts/${worker}/versions/${expectedVersion}`),
]);
const active = deployments.deployments?.[0]?.versions?.find((item) => item.percentage === 100);
if (active?.version_id !== expectedVersion || version?.id !== expectedVersion) {
  throw new Error("active_worker_version_changed");
}
const bindings = settings.bindings ?? [];
const versionBindings = version.resources?.bindings ?? [];
const bindingSignature = (items) => items.map((item) => ({
  name: item.name,
  type: item.type,
  value: item.type === "plain_text" ? item.text : undefined,
})).sort((a, b) => a.name.localeCompare(b.name));
if (JSON.stringify(bindingSignature(bindings)) !== JSON.stringify(bindingSignature(versionBindings))) {
  throw new Error("active_version_binding_mismatch");
}
const plainBindings = bindings.filter((item) => item.type === "plain_text");
const secretBindings = bindings.filter((item) => item.type === "secret_text");
if (bindings.length !== 51 || plainBindings.length !== 27 || secretBindings.length !== 24) {
  throw new Error("production_binding_types_changed");
}
const vars = Object.fromEntries(plainBindings.map((item) => [item.name, item.text]));
const secretNames = secretBindings.map((item) => item.name).sort();
const source = JSON.parse(readFileSync("wrangler.production.jsonc", "utf8"));
for (const [name, value] of Object.entries(source.env.production.vars)) {
  if (vars[name] !== value) throw new Error(`production_plain_var_drift:${name}`);
}
const official = JSON.parse(readFileSync("OFFICIAL_BASE.json", "utf8"));
const extraNames = official.productionBindings.additionalPlainNames;
if (extraNames.length !== 6 || extraNames.some((name) => !(name in vars))) {
  throw new Error("additional_production_vars_changed");
}
const cron = (schedules.schedules ?? []).map((item) => item.cron).sort();
const domainNames = (Array.isArray(domains) ? domains : [])
  .filter((item) => item.service === worker).map((item) => item.hostname).sort();
if (JSON.stringify(cron) !== JSON.stringify(["*/10 * * * *"]) ||
    JSON.stringify(domainNames) !== JSON.stringify(["bellza.pt", "www.bellza.pt"])) {
  throw new Error("production_cron_or_domains_changed");
}
const runtime = version.resources?.script_runtime;
if (runtime?.compatibility_date !== source.compatibility_date ||
    JSON.stringify(runtime.compatibility_flags?.slice().sort()) !==
      JSON.stringify(source.compatibility_flags.slice().sort())) {
  throw new Error("production_runtime_changed");
}
const config = {
  name: worker,
  main: "index.js",
  assets: { directory: "../client" },
  no_bundle: true,
  rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
  workers_dev: false,
  preview_urls: false,
  keep_vars: true,
  compatibility_date: runtime.compatibility_date,
  compatibility_flags: runtime.compatibility_flags,
  triggers: { crons: cron },
  vars,
  secrets: { required: secretNames },
};
const path = "dist/server/wrangler.referral.production.json";
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
const configHash = createHash("sha256").update(readFileSync(path)).digest("hex");
console.log(JSON.stringify({
  activeVersion: expectedVersion,
  bindings: bindings.length,
  plain: plainBindings.length,
  secrets: secretBindings.length,
  additionalPlainNames: extraNames,
  cron,
  domains: domainNames,
  runtime: { date: runtime.compatibility_date, flags: runtime.compatibility_flags },
  configPath: path,
  configSha256: configHash,
  noProductionMutation: true,
}));
