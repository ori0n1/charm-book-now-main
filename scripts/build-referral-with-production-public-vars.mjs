// Local build only. The live financial VITE bindings must be checked by OAuth,
// but their build-time opt-in is absent from the verified active Worker.
// Preserve the active compiled behavior until a separate release authorizes it.
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const mode = process.argv[2];
if (mode !== "active" && mode !== "rollback") {
  throw new Error("expected_active_or_rollback_mode");
}
const vars = JSON.parse(readFileSync("wrangler.production.jsonc", "utf8")).env.production.vars;
const official = JSON.parse(readFileSync("OFFICIAL_BASE.json", "utf8"));
if (!["959a93f7-bda1-4edc-8247-2d88e732da76", "93d3da35-f38c-4c1f-81d7-a7eab14fe50d", "dbce9473-991e-4294-8606-ceb0c78356e0", "e5bb73f6-a486-4236-99cc-996b4ec09666", "be47026f-6ad3-4f81-b85b-22d5e3c0d69a", "e1f3cde6-a395-4c38-81fb-02315bcd8099", "51d0b86b-30d0-435e-ac64-8ba158446ea0", "049e17b4-d407-4a6c-9c88-8eae7b910ea3", "df7b87d2-0b2e-4bb7-9753-0dca6bc32836", "1ef0f35f-098a-4879-8068-256580a647ed", "de5d7b7d-efe4-4c9a-a25a-118b930657b8", "4fd6911e-675b-46fa-a196-bb656724ec6d", "30e4e2ce-38de-484d-a511-0f3f70c85142"]
  .includes(official.cloudflareVersionId)) {
  throw new Error("financial_build_parity_reference_changed");
}
const required = [
  "VITE_CONNECT_FINANCIAL_LIVE_ENABLED",
  "VITE_CONNECT_FINANCIAL_LIVE_APP_ORIGIN",
  "VITE_CONNECT_FINANCIAL_LIVE_ENDPOINT",
];
if (required.some((name) => !vars[name])) throw new Error("production_public_vite_var_missing");
if (vars.VITE_CONNECT_FINANCIAL_LIVE_ENABLED !== "true") {
  throw new Error("financial_live_binding_changed");
}
const env = { ...process.env };
for (const name of required) delete env[name];
env.REFERRAL_PREMIUM_AWARDS_ENABLED = mode === "active" ? "true" : "false";
const result = spawnSync(process.execPath, ["scripts/build-safe.mjs"], {
  cwd: process.cwd(), env, stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  for (const area of ["server", "client"]) {
    const directory = join("dist", area, "assets");
    const matches = readdirSync(directory).filter((name) => /^admin-notifications-[A-Za-z0-9_-]+\.js$/.test(name));
    if (matches.length !== 1) throw new Error(`financial_bundle_missing_or_duplicated:${area}`);
    const bundle = readFileSync(join(directory, matches[0]), "utf8");
    if (bundle.includes(vars.VITE_CONNECT_FINANCIAL_LIVE_ENDPOINT) ||
        !bundle.includes("VITE_CONNECT_FINANCIAL_LIVE_ENABLED")) {
      throw new Error(`financial_live_build_opt_in_changed:${area}`);
    }
  }
  console.log("financial_build_opt_in_matches_active_reference");
}
