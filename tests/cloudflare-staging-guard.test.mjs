import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  STAGING_WORKER_NAME,
  assertCloudflareStagingContext,
  assertSafeWranglerConfiguration,
  assertWranglerStagingInvocation,
  fingerprintCloudflareAccount,
  verifyCloudflareStagingCredential,
} from "../scripts/lib/cloudflare-staging-guard.mjs";
import { removeWranglerDeployRedirect } from "../scripts/lib/wrangler-deploy-redirect.mjs";

const fakeAccountId = "a".repeat(32);
const goodEnv = () => ({
  CLOUDFLARE_DEPLOY_ENVIRONMENT: "staging",
  CLOUDFLARE_ENV: "staging",
  EXPECTED_CLOUDFLARE_WORKER_NAME: STAGING_WORKER_NAME,
  CLOUDFLARE_WORKER_NAME: STAGING_WORKER_NAME,
  CLOUDFLARE_ACCOUNT_ID: fakeAccountId,
  CLOUDFLARE_API_TOKEN: `cfat_${"x".repeat(32)}`,
});
const guardOptions = (env = goodEnv()) => ({
  env,
  expectedAccountFingerprint: fingerprintCloudflareAccount(fakeAccountId),
});

test("correct staging target reaches the pre-mutation boundary", () => {
  const context = assertCloudflareStagingContext(guardOptions());
  const invocation = assertWranglerStagingInvocation([
    "deploy",
    "--env",
    "staging",
    "--name",
    STAGING_WORKER_NAME,
  ]);
  assert.equal(context.workerName, STAGING_WORKER_NAME);
  assert.equal(invocation.environment, "staging");
});

test("production Worker aborts", () => {
  assert.throws(
    () =>
      assertCloudflareStagingContext(
        guardOptions({ ...goodEnv(), CLOUDFLARE_WORKER_NAME: "tanstack-start-app" }),
      ),
    /PRODUCTION_WORKER/u,
  );
});

test("missing environment aborts", () => {
  const env = goodEnv();
  delete env.CLOUDFLARE_DEPLOY_ENVIRONMENT;
  assert.throws(() => assertCloudflareStagingContext(guardOptions(env)), /MISSING_ENV/u);
});

test("divergent Worker aborts", () => {
  assert.throws(
    () =>
      assertCloudflareStagingContext(
        guardOptions({ ...goodEnv(), CLOUDFLARE_WORKER_NAME: "another-staging-worker" }),
      ),
    /WORKER_MISMATCH/u,
  );
});

test("generic deploy command aborts", () => {
  assert.throws(() => assertWranglerStagingInvocation(["deploy"]), /MISSING_ENVIRONMENT/u);
});

test("repository staging configuration passes the structural preflight", () => {
  const configText = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const result = assertSafeWranglerConfiguration({ configText });
  assert.equal(result.workerName, STAGING_WORKER_NAME);
  assert.equal(result.routes, 0);
  assert.equal(result.crons, 0);
});

test("a Vite-generated Wrangler deploy redirect aborts the preflight", () => {
  const cwd = mkdtempSync(join(tmpdir(), "bellza-wrangler-guard-"));
  const deployDirectory = join(cwd, ".wrangler", "deploy");
  mkdirSync(deployDirectory, { recursive: true });
  writeFileSync(join(deployDirectory, "config.json"), '{"configPath":"unsafe"}\n');
  assert.throws(
    () => assertSafeWranglerConfiguration({ cwd, configText: "{}" }),
    /wrangler_deploy_redirect_present/u,
  );
  assert.equal(removeWranglerDeployRedirect(cwd), true);
});

test("wrong Cloudflare account aborts", () => {
  assert.throws(
    () =>
      assertCloudflareStagingContext(
        guardOptions({ ...goodEnv(), CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) }),
      ),
    /ACCOUNT_MISMATCH/u,
  );
});

test("read-only token verification accepts only the staging Worker", async () => {
  const context = assertCloudflareStagingContext(guardOptions());
  const responses = [
    { ok: true, status: 200, json: async () => ({ success: true, result: { status: "active" } }) },
    {
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: [{ id: STAGING_WORKER_NAME }] }),
    },
  ];
  const result = await verifyCloudflareStagingCredential(context, {
    fetchImpl: async () => responses.shift(),
  });
  assert.deepEqual(result.visibleWorkers, [STAGING_WORKER_NAME]);
});

test("token visibility beyond staging aborts", async () => {
  const context = assertCloudflareStagingContext(guardOptions());
  const responses = [
    { ok: true, status: 200, json: async () => ({ success: true, result: { status: "active" } }) },
    {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: [{ id: STAGING_WORKER_NAME }, { id: "tanstack-start-app" }],
      }),
    },
  ];
  await assert.rejects(
    verifyCloudflareStagingCredential(context, { fetchImpl: async () => responses.shift() }),
    /TOKEN_SCOPE_MISMATCH/u,
  );
});
