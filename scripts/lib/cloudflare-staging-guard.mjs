import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertNoWranglerDeployRedirect } from "./wrangler-deploy-redirect.mjs";

export const STAGING_WORKER_NAME = "tanstack-start-app-staging";
export const PRODUCTION_WORKER_NAME = "tanstack-start-app";
export const DISABLED_ROOT_WORKER_NAME = "bellza-deploy-blocked";
export const STAGING_SUPABASE_REF = "qflwsdrgdkkcxjnbxmis";
export const STAGING_ACCOUNT_FINGERPRINT =
  "f58b55a893ddc1a36631650d54b1825de3a15c06b3c39faebb8adf947519264a";
export const WRANGLER_BUILD_GUARD_COMMAND = "node scripts/block-unsafe-wrangler-deploy.mjs";

const FORBIDDEN_DEPLOY_FLAGS = new Set([
  "--route",
  "--routes",
  "--domain",
  "--domains",
  "--schedule",
  "--schedules",
  "--triggers",
]);

export class CloudflareStagingGuardError extends Error {
  constructor(code, message) {
    super(`[CLOUDFLARE_STAGING_GUARD:${code}] ${message}`);
    this.name = "CloudflareStagingGuardError";
    this.code = code;
  }
}

export function fingerprintCloudflareAccount(accountId) {
  return createHash("sha256")
    .update(String(accountId ?? ""), "utf8")
    .digest("hex");
}

function required(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new CloudflareStagingGuardError("MISSING_ENV", `${name} is required`);
  return value;
}

export function assertCloudflareStagingContext({
  env = process.env,
  expectedAccountFingerprint = STAGING_ACCOUNT_FINGERPRINT,
} = {}) {
  const deployEnvironment = required(env, "CLOUDFLARE_DEPLOY_ENVIRONMENT");
  const wranglerEnvironment = required(env, "CLOUDFLARE_ENV");
  const expectedWorker = required(env, "EXPECTED_CLOUDFLARE_WORKER_NAME");
  const targetWorker = required(env, "CLOUDFLARE_WORKER_NAME");
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID");
  const apiToken = required(env, "CLOUDFLARE_API_TOKEN");

  if (deployEnvironment !== "staging" || wranglerEnvironment !== "staging") {
    throw new CloudflareStagingGuardError(
      "WRONG_ENVIRONMENT",
      "both deployment selectors must be exactly staging",
    );
  }
  if (expectedWorker !== STAGING_WORKER_NAME || targetWorker !== STAGING_WORKER_NAME) {
    const code =
      expectedWorker === PRODUCTION_WORKER_NAME || targetWorker === PRODUCTION_WORKER_NAME
        ? "PRODUCTION_WORKER"
        : "WORKER_MISMATCH";
    throw new CloudflareStagingGuardError(code, "the only authorized target is the staging Worker");
  }
  if (!/^[a-f0-9]{32}$/u.test(accountId)) {
    throw new CloudflareStagingGuardError(
      "INVALID_ACCOUNT",
      "CLOUDFLARE_ACCOUNT_ID must be a 32-character account identifier",
    );
  }
  if (fingerprintCloudflareAccount(accountId) !== expectedAccountFingerprint) {
    throw new CloudflareStagingGuardError(
      "ACCOUNT_MISMATCH",
      "the Cloudflare account is not the audited Bellza account",
    );
  }
  if (!/^cfat_[A-Za-z0-9_-]{20,}$/u.test(apiToken)) {
    throw new CloudflareStagingGuardError(
      "INVALID_TOKEN",
      "CLOUDFLARE_API_TOKEN is missing or has an invalid account-token format",
    );
  }

  return Object.freeze({
    deployEnvironment,
    workerName: targetWorker,
    accountId,
    accountFingerprint: expectedAccountFingerprint,
    apiToken,
  });
}

function readFlagValue(args, flag) {
  const exact = args.indexOf(flag);
  const inline = args.find((value) => value.startsWith(`${flag}=`));
  if (exact >= 0 && inline)
    throw new CloudflareStagingGuardError(
      "AMBIGUOUS_COMMAND",
      `${flag} was provided more than once`,
    );
  if (inline) return inline.slice(flag.length + 1);
  if (exact < 0) return null;
  return args[exact + 1] ?? "";
}

export function assertWranglerStagingInvocation(args) {
  if (!Array.isArray(args) || args[0] !== "deploy") {
    throw new CloudflareStagingGuardError(
      "UNSUPPORTED_COMMAND",
      "only an explicit staging deploy command can pass this preflight",
    );
  }
  const environment = readFlagValue(args, "--env");
  const workerName = readFlagValue(args, "--name");
  if (!environment)
    throw new CloudflareStagingGuardError("MISSING_ENVIRONMENT", "--env staging is mandatory");
  if (environment !== "staging")
    throw new CloudflareStagingGuardError("WRONG_ENVIRONMENT", "--env must be exactly staging");
  if (workerName !== STAGING_WORKER_NAME) {
    throw new CloudflareStagingGuardError(
      "WORKER_MISMATCH",
      "--name must identify the staging Worker exactly",
    );
  }
  for (const arg of args) {
    const flag = arg.split("=", 1)[0];
    if (FORBIDDEN_DEPLOY_FLAGS.has(flag)) {
      throw new CloudflareStagingGuardError(
        "FORBIDDEN_OVERRIDE",
        `${flag} cannot be supplied by a staging deploy command`,
      );
    }
  }
  return Object.freeze({ environment, workerName });
}

function parseJsonc(text) {
  const withoutComments = text.replace(/^\s*\/\/.*$/gmu, "");
  return JSON.parse(withoutComments.replace(/,\s*([}\]])/gu, "$1"));
}

export function assertSafeWranglerConfiguration({ cwd = process.cwd(), configText } = {}) {
  assertNoWranglerDeployRedirect(cwd);
  const raw = configText ?? readFileSync(resolve(cwd, "wrangler.jsonc"), "utf8");
  let config;
  try {
    config = parseJsonc(raw);
  } catch {
    throw new CloudflareStagingGuardError(
      "INVALID_CONFIG",
      "wrangler.jsonc could not be parsed safely",
    );
  }

  if (config.name !== DISABLED_ROOT_WORKER_NAME || config.workers_dev !== false) {
    throw new CloudflareStagingGuardError(
      "UNSAFE_ROOT",
      "the root Wrangler target is not disabled",
    );
  }
  if ((config.routes?.length ?? 0) !== 0 || (config.triggers?.crons?.length ?? 0) !== 0) {
    throw new CloudflareStagingGuardError(
      "UNSAFE_ROOT_BINDINGS",
      "the root Wrangler target contains routes or schedules",
    );
  }
  if (config.build?.command !== WRANGLER_BUILD_GUARD_COMMAND) {
    throw new CloudflareStagingGuardError(
      "MISSING_BUILD_GUARD",
      "the Wrangler pre-upload guard is not configured",
    );
  }

  const staging = config.env?.staging;
  if (!staging || staging.name !== STAGING_WORKER_NAME || staging.workers_dev !== true) {
    throw new CloudflareStagingGuardError(
      "INVALID_STAGING_CONFIG",
      "the staging Worker identity is not explicit",
    );
  }
  if ((staging.routes?.length ?? -1) !== 0 || (staging.triggers?.crons?.length ?? -1) !== 0) {
    throw new CloudflareStagingGuardError(
      "STAGING_BINDINGS",
      "staging must have explicit empty routes and schedules",
    );
  }
  if (
    staging.vars?.STRIPE_ENV !== "sandbox" ||
    staging.vars?.VITE_SUPABASE_PROJECT_ID !== STAGING_SUPABASE_REF
  ) {
    throw new CloudflareStagingGuardError(
      "STAGING_SERVICE_MISMATCH",
      "staging Stripe/Supabase selectors are inconsistent",
    );
  }
  const serializedStaging = JSON.stringify(staging);
  if (
    serializedStaging.includes(PRODUCTION_WORKER_NAME + '"') ||
    serializedStaging.includes('"STRIPE_ENV":"live"') ||
    serializedStaging.includes("bellza.pt")
  ) {
    throw new CloudflareStagingGuardError(
      "PRODUCTION_MARKER",
      "the staging configuration contains a production marker",
    );
  }

  return Object.freeze({
    rootTarget: config.name,
    workerName: staging.name,
    workersDev: staging.workers_dev,
    routes: staging.routes.length,
    crons: staging.triggers.crons.length,
    stripeEnvironment: staging.vars.STRIPE_ENV,
    supabaseProjectRef: staging.vars.VITE_SUPABASE_PROJECT_ID,
  });
}

async function readCloudflareJson(response, code) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new CloudflareStagingGuardError(code, "Cloudflare returned a non-JSON response");
  }
  if (!response.ok || body?.success !== true) {
    throw new CloudflareStagingGuardError(
      code,
      `Cloudflare read-only verification failed with HTTP ${response.status}`,
    );
  }
  return body;
}

export async function verifyCloudflareStagingCredential(context, { fetchImpl = fetch } = {}) {
  const headers = { Authorization: `Bearer ${context.apiToken}` };
  const base = `https://api.cloudflare.com/client/v4/accounts/${context.accountId}`;

  const verification = await readCloudflareJson(
    await fetchImpl(`${base}/tokens/verify`, { method: "GET", headers }),
    "TOKEN_VERIFY_FAILED",
  );
  if (verification.result?.status !== "active") {
    throw new CloudflareStagingGuardError("TOKEN_INACTIVE", "the Cloudflare token is not active");
  }

  const scripts = await readCloudflareJson(
    await fetchImpl(`${base}/workers/scripts`, { method: "GET", headers }),
    "WORKER_SCOPE_VERIFY_FAILED",
  );
  const visibleWorkers = Array.isArray(scripts.result)
    ? scripts.result
        .map((item) => item?.id ?? item?.name)
        .filter(Boolean)
        .sort()
    : [];
  if (visibleWorkers.length !== 1 || visibleWorkers[0] !== STAGING_WORKER_NAME) {
    throw new CloudflareStagingGuardError(
      "TOKEN_SCOPE_MISMATCH",
      "the token does not enumerate exactly the authorized staging Worker",
    );
  }

  return Object.freeze({ tokenStatus: "active", visibleWorkers });
}

export function sanitizedCloudflareGuardResult(context, config, credential) {
  return {
    allowed: true,
    environment: context.deployEnvironment,
    workerName: context.workerName,
    accountFingerprint: context.accountFingerprint,
    tokenStatus: credential?.tokenStatus ?? "not-checked",
    visibleWorkers: credential?.visibleWorkers ?? "not-checked",
    workersDev: config.workersDev,
    routes: config.routes,
    crons: config.crons,
    stoppedBeforeMutation: true,
  };
}
