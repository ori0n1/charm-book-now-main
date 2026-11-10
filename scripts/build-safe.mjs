import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { removeWranglerDeployRedirect } from "./lib/wrangler-deploy-redirect.mjs";

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const featureContract = fileURLToPath(new URL("../tests/client-duplicates-filter.test.mjs", import.meta.url));
const duplicateTests = fileURLToPath(new URL("../tests/client-duplicates.test.mjs", import.meta.url));
const archiveTests = fileURLToPath(new URL("../tests/client-profile-archive.test.mjs", import.meta.url));
const centralTests = fileURLToPath(new URL("../tests/platform-central.test.mjs", import.meta.url));
const metricsTests = fileURLToPath(new URL("../tests/platform-metrics-qualification.test.mjs", import.meta.url));
const contract = spawnSync(process.execPath, ["--test", featureContract, duplicateTests, archiveTests, centralTests, metricsTests], {
  cwd: process.cwd(), env: process.env, stdio: "inherit", windowsHide: true,
});
if (contract.error || contract.status !== 0) {
  console.error("release_feature_contract_failed", contract.error?.message ?? contract.status);
  process.exit(1);
}
removeWranglerDeployRedirect();
const result = spawnSync(process.execPath, [viteCli, "build"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
removeWranglerDeployRedirect();

if (result.error) {
  console.error("safe_build_failed", result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
