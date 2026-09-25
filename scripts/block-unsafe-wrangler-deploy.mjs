import {
  assertCloudflareStagingContext,
  assertSafeWranglerConfiguration,
  verifyCloudflareStagingCredential,
} from "./lib/cloudflare-staging-guard.mjs";

const context = assertCloudflareStagingContext();
assertSafeWranglerConfiguration();
await verifyCloudflareStagingCredential(context);
process.stdout.write("cloudflare_staging_preupload_guard_ok\n");
