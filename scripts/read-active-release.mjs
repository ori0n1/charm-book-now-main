import { readFileSync } from "node:fs";
import { join } from "node:path";

const token = readFileSync(join(process.env.APPDATA ?? "", "xdg.config", ".wrangler", "config", "default.toml"), "utf8")
  .match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error("cloudflare_read_token_unavailable");
const root = "https://api.cloudflare.com/client/v4/accounts/5c4cb61495df81feda4da7d1098e098e";
async function get(path) {
  const response = await fetch(root + path, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`cloudflare_read_failed:${response.status}`);
  return body.result;
}
const script = "/workers/scripts/tanstack-start-app";
const [deployments, settings, schedules] = await Promise.all([
  get(`${script}/deployments`), get(`${script}/settings`), get(`${script}/schedules`),
]);
const requestedVersion = process.argv[2];
const version = requestedVersion ? await get(`${script}/versions/${requestedVersion}`) : null;
const versionBindings = version?.resources?.bindings ?? [];
const versions = deployments.deployments?.[0]?.versions ?? [];
const active = versions.find((version) => version.percentage === 100);
const bindings = settings.bindings ?? [];
const plain = Object.fromEntries(bindings.filter((binding) => binding.type === "plain_text")
  .map((binding) => [binding.name, binding.text]));
console.log(JSON.stringify({
  activeVersion: active?.version_id,
  bindingsCount: bindings.length,
  plain,
  secretNames: bindings.filter((binding) => binding.type === "secret_text").map((binding) => binding.name).sort(),
  schedules: schedules.schedules ?? schedules,
  requestedVersion: version?.id,
  requestedVersionBindingCount: version ? versionBindings.length : undefined,
  requestedVersionSecretNames: version ? versionBindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort() : undefined,
  requestedVersionJointCreation: version ? versionBindings.find((binding) =>
    binding.name === "JOINT_BOOKING_CREATE_ENABLED")?.text : undefined,
  requestedVersionRuntime: version?.resources?.script_runtime,
}, null, 2));
