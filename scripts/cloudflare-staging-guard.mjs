import {
  assertCloudflareStagingContext,
  assertSafeWranglerConfiguration,
  assertWranglerStagingInvocation,
  sanitizedCloudflareGuardResult,
  verifyCloudflareStagingCredential,
} from "./lib/cloudflare-staging-guard.mjs";

const args = new Set(process.argv.slice(2));
if (!args.has("--check-only")) {
  throw new Error("This command is preflight-only. Pass --check-only; it never deploys a Worker.");
}

const context = assertCloudflareStagingContext();
const config = assertSafeWranglerConfiguration();
assertWranglerStagingInvocation(["deploy", "--env", "staging", "--name", context.workerName]);
const credential = args.has("--verify-token")
  ? await verifyCloudflareStagingCredential(context)
  : null;

process.stdout.write(
  `${JSON.stringify(sanitizedCloudflareGuardResult(context, config, credential), null, 2)}\n`,
);
