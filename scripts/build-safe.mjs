import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { removeWranglerDeployRedirect } from "./lib/wrangler-deploy-redirect.mjs";

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
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
