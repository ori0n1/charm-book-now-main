// Local build only. The three public VITE values must match the live bindings,
// checked first by prepare-referral-release-config.mjs.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "active" && mode !== "rollback") {
  throw new Error("expected_active_or_rollback_mode");
}
const vars = JSON.parse(readFileSync("wrangler.production.jsonc", "utf8")).env.production.vars;
const required = [
  "VITE_CONNECT_FINANCIAL_LIVE_ENABLED",
  "VITE_CONNECT_FINANCIAL_LIVE_APP_ORIGIN",
  "VITE_CONNECT_FINANCIAL_LIVE_ENDPOINT",
];
if (required.some((name) => !vars[name])) throw new Error("production_public_vite_var_missing");
const env = { ...process.env };
for (const name of required) env[name] = vars[name];
env.REFERRAL_PREMIUM_AWARDS_ENABLED = mode === "active" ? "true" : "false";
const result = spawnSync(process.execPath, ["scripts/build-safe.mjs"], {
  cwd: process.cwd(), env, stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
