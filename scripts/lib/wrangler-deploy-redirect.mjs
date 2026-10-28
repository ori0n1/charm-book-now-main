import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export function wranglerDeployRedirectPath(cwd = process.cwd()) {
  return resolve(cwd, ".wrangler", "deploy", "config.json");
}

export function removeWranglerDeployRedirect(cwd = process.cwd()) {
  const path = wranglerDeployRedirectPath(cwd);
  if (existsSync(path)) rmSync(path, { force: true });
  return !existsSync(path);
}

export function assertNoWranglerDeployRedirect(cwd = process.cwd()) {
  if (existsSync(wranglerDeployRedirectPath(cwd))) {
    throw new Error("wrangler_deploy_redirect_present");
  }
}
