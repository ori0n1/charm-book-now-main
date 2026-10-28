import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expectedVersion = "4131a311-23f8-4745-ba5c-a47a2300cb1c";
const candidateVersion = "78b0fa96-db38-4804-a65e-9375ab3097a3";
const rollbackVersion = "a4d089ba-5286-4617-ab78-1768e517c97c";
const expectedCommand = "node scripts/verify-multiprofessional-release.mjs --production";
const releasePath = join(root, "dist/server/wrangler.production-release.json");
const rollbackPath = join(root, "dist/server/wrangler.production-rollback.json");
const manifestPath = join(root, "release-manifest.json");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileSha = (path) => sha(readFileSync(path));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function treeSha(paths, excluded = new Set()) {
  const files = [];
  for (const source of paths) {
    const full = join(root, source);
    if (!existsSync(full)) throw new Error(`release_file_missing:${source}`);
    function visit(path) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (excluded.has(entry.name)) continue;
        const child = join(path, entry.name);
        if (entry.isDirectory()) visit(child);
        else if (entry.isFile()) files.push(child);
      }
    }
    if (source.includes(".") && !source.startsWith("dist/")) files.push(full);
    else visit(full);
  }
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(root, file).replaceAll("\\", "/"));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

function jointMigrationsSha() {
  const dir = join(root, "supabase/migrations");
  const names = readdirSync(dir).filter((name) => /^20261019\d+_.+\.sql$/.test(name)).sort();
  if (names.length !== 13) throw new Error("joint_migration_set_changed");
  const hash = createHash("sha256");
  for (const name of names) {
    hash.update(name);
    hash.update(readFileSync(join(dir, name)));
  }
  return hash.digest("hex");
}

function releaseConfig(rollback = false) {
  const source = JSON.parse(readFileSync(join(root, "wrangler.production.jsonc"), "utf8"));
  const baseline = JSON.parse(readFileSync(join(root, "production-active-config.json"), "utf8"));
  if (source.build?.command !== expectedCommand || source.keep_vars !== true ||
      source.env?.production?.name !== "tanstack-start-app" ||
      source.env.production.vars?.VITE_SUPABASE_PROJECT_ID !== "pwmdzpvnatrvfpgcvnzg" ||
      !same(source.env.production.triggers?.crons, ["*/10 * * * *"])) {
    throw new Error("production_source_config_mismatch");
  }
  for (const [name, value] of Object.entries(source.env.production.vars)) {
    if (baseline.vars?.[name] !== value) throw new Error(`production_var_drift:${name}`);
  }
  if (baseline.name !== "tanstack-start-app" || baseline.main !== "index.js" ||
      baseline.assets?.directory !== "../client" || baseline.keep_vars !== true ||
      !same(baseline.compatibility_flags, source.compatibility_flags) ||
      baseline.compatibility_date !== source.compatibility_date) {
    throw new Error("production_baseline_config_mismatch");
  }
  const release = structuredClone(baseline);
  release.vars.JOINT_BOOKING_CREATE_ENABLED = rollback ? "false" : "true";
  release.triggers.crons = ["*/10 * * * *"];
  release.build = { command: expectedCommand };
  return release;
}

function localEvidence() {
  if (!existsSync(join(root, "dist/server/index.js")) ||
      !existsSync(join(root, "dist/client/assets"))) {
    throw new Error("compiled_candidate_missing");
  }
  const actualConfig = JSON.parse(readFileSync(releasePath, "utf8"));
  if (!same(actualConfig, releaseConfig())) throw new Error("release_artifact_config_mismatch");
  const actualRollback = JSON.parse(readFileSync(rollbackPath, "utf8"));
  if (!same(actualRollback, releaseConfig(true))) throw new Error("rollback_artifact_config_mismatch");
  return {
    baselineVersion: expectedVersion,
    candidateVersion,
    rollbackVersion,
    sourceSha256: treeSha(["src", "public", "package.json", "package-lock.json", "vite.config.ts", "wrangler.jsonc", "wrangler.production.jsonc"]),
    artifactSha256: treeSha(["dist/client", "dist/server"], new Set(["wrangler.production-release.json", "wrangler.production-rollback.json"])),
    configSha256: fileSha(releasePath),
    rollbackConfigSha256: fileSha(rollbackPath),
    migrationsSha256: jointMigrationsSha(),
    schemaApplySha256: fileSha(join(root, "production-apply-joint.sql")),
    guardSha256: fileSha(new URL(import.meta.url)),
  };
}

async function verifyRemote(release, activeVersion = expectedVersion) {
  const config = readFileSync(join(process.env.APPDATA ?? "", "xdg.config", ".wrangler", "config", "default.toml"), "utf8");
  const token = process.env.BELLZA_CLOUDFLARE_READ_TOKEN?.trim() ||
    config.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error("cloudflare_read_token_missing");
  const rootUrl = "https://api.cloudflare.com/client/v4/accounts/5c4cb61495df81feda4da7d1098e098e";
  async function get(path) {
    const response = await fetch(rootUrl + path, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json();
    if (!response.ok || body.success !== true) throw new Error(`cloudflare_read_failed:${response.status}`);
    return body.result;
  }
  const path = "/workers/scripts/tanstack-start-app";
  const [deployments, settings, schedules, version, candidate, rollback] = await Promise.all([
    get(`${path}/deployments`), get(`${path}/settings`), get(`${path}/schedules`),
    get(`${path}/versions/${expectedVersion}`),
    get(`${path}/versions/${candidateVersion}`), get(`${path}/versions/${rollbackVersion}`),
  ]);
  const active = deployments.deployments?.[0]?.versions?.find((item) => item.percentage === 100);
  if (active?.version_id !== activeVersion || version.id !== expectedVersion) {
    throw new Error("production_version_changed");
  }
  const plain = Object.fromEntries((settings.bindings ?? [])
    .filter((item) => item.type === "plain_text").map((item) => [item.name, item.text]));
  const baseline = JSON.parse(readFileSync(join(root, "production-active-config.json"), "utf8"));
  const extraJointFlag = plain.JOINT_BOOKING_CREATE_ENABLED;
  delete plain.JOINT_BOOKING_CREATE_ENABLED;
  if (!same(Object.entries(plain).sort(), Object.entries(baseline.vars).sort()) ||
      (extraJointFlag !== undefined && extraJointFlag !== "false" && extraJointFlag !== "true")) {
    throw new Error("production_plain_bindings_changed");
  }
  if (activeVersion === candidateVersion && extraJointFlag !== "true") {
    throw new Error("candidate_joint_creation_binding_disabled");
  }
  const secretNames = (settings.bindings ?? []).filter((item) => item.type === "secret_text")
    .map((item) => item.name).sort();
  const expectedSecrets = [
    "ARARA_API_KEY", "GOOGLE_PLACES_API_KEY", "LIFECYCLE_CRON_TOKEN",
    "PAYMENTS_LIVE_CONNECT_WEBHOOK_SECRET", "RESEND_API_KEY", "SENDDM_API_KEY",
    "SENDDM_CONFIRMATION_API_KEY", "STRIPE_LIVE_API_KEY", "STRIPE_LIVE_PRICE_MONTHLY",
    "STRIPE_LIVE_PRICE_PREMIUM_MONTHLY", "STRIPE_LIVE_PRICE_PREMIUM_YEARLY",
    "STRIPE_LIVE_PRICE_PRO_MONTHLY", "STRIPE_LIVE_PRICE_PRO_YEARLY",
    "STRIPE_LIVE_PRICE_QUARTERLY", "STRIPE_LIVE_PRICE_YEARLY",
    "STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_SANDBOX_API_KEY",
    "SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
  ].sort();
  if (!same(secretNames, expectedSecrets) ||
      settings.bindings.length !== (extraJointFlag === undefined ? 50 : 51)) {
    throw new Error("production_secret_bindings_changed");
  }
  for (const [label, uploaded, expectedConfig] of [
    ["candidate", candidate, releaseConfig()],
    ["rollback", rollback, releaseConfig(true)],
  ]) {
    const bindings = uploaded.resources?.bindings ?? [];
    const uploadedPlain = Object.fromEntries(bindings.filter((item) => item.type === "plain_text")
      .map((item) => [item.name, item.text]));
    const uploadedSecrets = bindings.filter((item) => item.type === "secret_text")
      .map((item) => item.name).sort();
    if (uploaded.id !== (label === "candidate" ? candidateVersion : rollbackVersion) ||
        !same(Object.entries(uploadedPlain).sort(), Object.entries(expectedConfig.vars).sort()) ||
        !same(uploadedSecrets, expectedSecrets) || bindings.length !== 51 ||
        uploaded.resources?.script_runtime?.compatibility_date !== expectedConfig.compatibility_date ||
        !same(uploaded.resources.script_runtime.compatibility_flags, expectedConfig.compatibility_flags)) {
      throw new Error(`uploaded_${label}_configuration_mismatch`);
    }
  }
  if (!same((schedules.schedules ?? []).map((item) => item.cron), release.triggers.crons) ||
      version.resources?.script_runtime?.compatibility_date !== release.compatibility_date ||
      !same(version.resources.script_runtime.compatibility_flags, release.compatibility_flags)) {
    throw new Error("production_runtime_or_schedule_changed");
  }
  return { activeVersion, candidateVersion, rollbackVersion,
    bindingCount: settings.bindings.length, secretCount: 24, cron: release.triggers.crons[0] };
}

if (process.argv[2] === "--prepare") {
  const config = releaseConfig();
  writeFileSync(releasePath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(rollbackPath, `${JSON.stringify(releaseConfig(true), null, 2)}\n`);
  const evidence = localEvidence();
  writeFileSync(manifestPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ prepared: true, ...evidence }));
} else if (process.argv[2] === "--production") {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const evidence = localEvidence();
  if (!same(manifest, evidence)) {
    const changed = Object.keys(evidence).filter((key) => manifest[key] !== evidence[key]);
    throw new Error(`candidate_changed_since_validation:${changed.join(",")}`);
  }
  const remote = await verifyRemote(releaseConfig());
  console.log(JSON.stringify({ guard: "passed", ...remote,
    sourceSha256: evidence.sourceSha256, artifactSha256: evidence.artifactSha256 }));
} else if (process.argv[2] === "--postdeploy") {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const evidence = localEvidence();
  if (!same(manifest, evidence)) throw new Error("candidate_changed_since_validation");
  const remote = await verifyRemote(releaseConfig(), candidateVersion);
  console.log(JSON.stringify({ guard: "postdeploy_passed", ...remote }));
} else if (process.argv[2] === "--diagnose-source") {
  console.log(JSON.stringify(Object.fromEntries([
    "src", "public", "package.json", "package-lock.json", "vite.config.ts",
    "wrangler.jsonc", "wrangler.production.jsonc",
  ].map((path) => [path, treeSha([path])]))));
} else {
  throw new Error("explicit_release_mode_required");
}
