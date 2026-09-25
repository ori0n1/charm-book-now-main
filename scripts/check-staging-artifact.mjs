import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const productionOrigin = "https://pwmdzpvnatrvfpgcvnzg.supabase.co";
const failures = [];

let config;
try {
  config = JSON.parse(readFileSync(resolve("dist/server/wrangler.json"), "utf8"));
} catch {
  console.error("staging_artifact_missing: run npm run build:staging first");
  process.exit(1);
}

const vars = config.vars ?? {};
if (config.name !== "tanstack-start-app-staging") failures.push("worker_name");
if (config.targetEnvironment !== "staging") failures.push("target_environment");
if (!config.workers_dev) failures.push("workers_dev");
if (!Array.isArray(config.routes) || config.routes.length) failures.push("routes");
if (!Array.isArray(config.triggers?.crons) || config.triggers.crons.length) {
  failures.push("crons");
}
if (vars.STRIPE_ENV !== "sandbox") failures.push("stripe_env");
if (vars.STRIPE_CONNECT_NEW_ACCOUNT_MODEL !== "standard_full_v1") {
  failures.push("stripe_connect_account_model");
}
if (vars.ENABLE_IN_PERSON_MB_WAY !== "false") failures.push("in_person_mb_way");
if (vars.EMAIL_NOTIFICATIONS_ENABLED !== "false") failures.push("email_notifications");

const requiredVars = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_VAPID_PUBLIC_KEY",
  "APP_URL",
  "STRIPE_SANDBOX_PRICE_PRO_MONTHLY",
  "STRIPE_SANDBOX_PRICE_PRO_YEARLY",
  "STRIPE_SANDBOX_PRICE_PREMIUM_MONTHLY",
  "STRIPE_SANDBOX_PRICE_PREMIUM_YEARLY",
];
for (const name of requiredVars) {
  if (typeof vars[name] !== "string" || !vars[name].trim()) failures.push(name);
}

let supabaseOrigin = "";
try {
  const parsed = new URL(vars.SUPABASE_URL);
  if (parsed.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) {
    supabaseOrigin = parsed.origin;
  }
} catch {
  // Report a generic configuration failure without printing values.
}
if (!supabaseOrigin || supabaseOrigin === productionOrigin) failures.push("supabase_origin");
if (vars.VITE_SUPABASE_URL !== supabaseOrigin) failures.push("browser_supabase_origin");
if (vars.VITE_SUPABASE_PUBLISHABLE_KEY !== vars.SUPABASE_PUBLISHABLE_KEY) {
  failures.push("browser_supabase_key");
}

try {
  const assetsDir = resolve("dist/client/assets");
  const browserCode = readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(resolve(assetsDir, name), "utf8"))
    .join("\n");
  if (!supabaseOrigin || !browserCode.includes(supabaseOrigin)) {
    failures.push("browser_bundle_supabase_origin");
  }
  if (!vars.VITE_SUPABASE_PUBLISHABLE_KEY ||
      !browserCode.includes(vars.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    failures.push("browser_bundle_supabase_key");
  }
  if (browserCode.includes(productionOrigin)) failures.push("browser_bundle_production_origin");
} catch {
  failures.push("browser_bundle_missing");
}

try {
  const appUrl = new URL(vars.APP_URL);
  if (appUrl.protocol !== "https:" || ["bellza.pt", "www.bellza.pt"].includes(appUrl.hostname)) {
    failures.push("app_origin");
  }
} catch {
  failures.push("app_origin");
}

if (failures.length) {
  console.error(`staging_artifact_incomplete: ${[...new Set(failures)].join(", ")}`);
  process.exit(1);
}

console.log("staging_artifact_configuration_ok");
