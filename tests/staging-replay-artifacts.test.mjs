import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { verifyStagingReplayArtifacts } from "../scripts/verify-staging-replay-artifacts.mjs";

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const verifier = path.join(repositoryRoot, "scripts", "verify-staging-replay-artifacts.mjs");

test("verifies the frozen staging-only artifacts outside the operational tree", async () => {
  const result = await verifyStagingReplayArtifacts({ repositoryRoot });

  assert.equal(result.context, "local-disposable-staging-replay");
  assert.equal(result.networkAccess, false);
  assert.equal(result.sqlExecuted, false);
  assert.equal(result.gitLineEndingNormalization, false);
  assert.deepEqual(
    result.verified.map(({ version, sha256, operationalCollision }) => ({
      version,
      sha256,
      operationalCollision,
    })),
    [
      {
        version: "20260918180000",
        sha256: "b2c152495c591d0eacf2c4cd4f67a1b4905b6006526eeff9c960d04f2781017c",
        operationalCollision: false,
      },
      {
        version: "20260919151000",
        sha256: "9cd8586d272923bb9158949f4a87ce2e38e85af9efdf1a44d7641bef5411b06c",
        operationalCollision: false,
      },
    ],
  );
});

test("CLI fails closed without the explicit disposable-local context", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [verifier, "--verify"], {
      cwd: repositoryRoot,
      windowsHide: true,
    }),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /local context are required/);
      return true;
    },
  );
});

test("CLI accepts only the exact read-only verification invocation", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [verifier, "--verify", "--context=local-disposable-staging-replay"],
    { cwd: repositoryRoot, windowsHide: true },
  );

  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.verified.length, 2);
  assert.equal(result.networkAccess, false);
  assert.equal(result.sqlExecuted, false);
  assert.equal(result.gitLineEndingNormalization, false);
});
