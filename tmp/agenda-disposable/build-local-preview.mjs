import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const output = execFileSync("supabase", ["status", "--workdir", "tmp/agenda-disposable", "-o", "json"], { encoding: "utf8" });
const local = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
assert.equal(local.API_URL, "http://127.0.0.1:57921");
const env = { ...process.env,
  VITE_SUPABASE_URL: local.API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
  SUPABASE_URL: local.API_URL,
  SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  ENABLE_IN_PERSON_MB_WAY: "false",
};
const result = spawnSync(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "build", "--mode", "development"],
  { env, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
if (result.status !== 0) {
  process.stderr.write((result.stdout + result.stderr).slice(-5000));
  process.exit(result.status ?? 1);
}
console.log("Local Worker preview build OK");
