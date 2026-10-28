import {
  assertCloudflareStagingContext,
  assertSafeWranglerConfiguration,
  verifyCloudflareStagingCredential,
} from "./lib/cloudflare-staging-guard.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--production') {
  const { assertProductionContext, assertProductionConfig, assertProductionArtifact, verifyProductionReadiness } = await import('./lib/cloudflare-production-guard.mjs');
  const context = assertProductionContext({ explicitProduction: true });
  assertProductionConfig({ requireRootMatch: true });
  assertProductionArtifact();
  await verifyProductionReadiness(context, { requirePlaces: true });
  process.stdout.write('cloudflare_production_preupload_guard_ok\n');
} else {
  if (args.length) throw new Error('unsupported_deployment_guard_arguments');
  const context = assertCloudflareStagingContext();
  assertSafeWranglerConfiguration();
  await verifyCloudflareStagingCredential(context);
  process.stdout.write("cloudflare_staging_preupload_guard_ok\n");
}
