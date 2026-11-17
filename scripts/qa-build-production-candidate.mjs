// Builds a local production-mode candidate; does not invoke Wrangler or alter
// the existing local deploy redirect. Public VITE values come from the already
// prepared local production config and are never printed by this script.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const config = JSON.parse(readFileSync("wrangler.production.jsonc", "utf8"));
const vars = config.env?.production?.vars ?? {};
const required = [
  "VITE_CONNECT_FINANCIAL_LIVE_ENABLED",
  "VITE_CONNECT_FINANCIAL_LIVE_APP_ORIGIN",
  "VITE_CONNECT_FINANCIAL_LIVE_ENDPOINT",
];
if (required.some((name) => typeof vars[name] !== "string" || !vars[name])) {
  throw new Error("PRODUCTION_PUBLIC_VITE_VARS_UNAVAILABLE");
}
const env = { ...process.env, REFERRAL_PREMIUM_AWARDS_ENABLED: "true" };
for (const name of required) env[name] = vars[name];
const vite = resolve("..", "node_modules", "vite", "bin", "vite.js");
const result = spawnSync(process.execPath, [vite, "build", "--mode", "production"], {
  cwd: process.cwd(), env, stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
