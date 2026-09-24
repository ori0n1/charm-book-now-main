import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, "..");
const manifestRelativePath = path.join(
  "artifacts",
  "bellza-staging-remote",
  "staging-replay-manifest.json",
);
const operationalMigrationDirectory = path.join("supabase", "migrations");
const requiredContext = "local-disposable-staging-replay";

const expectedArtifacts = Object.freeze([
  Object.freeze({
    version: "20260918180000",
    filename: "supabase/migrations/20260918180000_public_schema_baseline.sql",
    sha256: "b2c152495c591d0eacf2c4cd4f67a1b4905b6006526eeff9c960d04f2781017c",
    classification: "staging-only-baseline",
    order: 1,
  }),
  Object.freeze({
    version: "20260919151000",
    filename: "supabase/migrations/20260919151000_staging_storage_fixture.sql",
    sha256: "9cd8586d272923bb9158949f4a87ce2e38e85af9efdf1a44d7641bef5411b06c",
    classification: "staging-only-synthetic-fixture",
    order: 10,
  }),
]);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`staging replay artifact guard: ${message}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertStringArray(values, fieldName) {
  invariant(Array.isArray(values) && values.length > 0, `${fieldName} is empty`);
  invariant(
    values.every((value) => typeof value === "string" && value.length > 0),
    `${fieldName} contains an invalid value`,
  );
}

export async function verifyStagingReplayArtifacts({
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  const manifestPath = path.join(repositoryRoot, manifestRelativePath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  invariant(manifest.schemaVersion === 1, "unsupported manifest schemaVersion");
  invariant(manifest.immutable === true, "manifest must be immutable");
  invariant(manifest.artifactRoot === "artifacts/bellza-staging-remote", "unexpected artifactRoot");
  invariant(
    manifest.operationalMigrationDirectory === "supabase/migrations",
    "unexpected operational migration directory",
  );
  invariant(manifest.allowedContext === requiredContext, "unexpected context");
  invariant(
    Array.isArray(manifest.artifacts) && manifest.artifacts.length === expectedArtifacts.length,
    "unexpected artifact count",
  );

  const operationalFiles = await readdir(path.join(repositoryRoot, operationalMigrationDirectory));
  const gitAttributeRules = new Set(
    (await readFile(path.join(repositoryRoot, ".gitattributes"), "utf8"))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const verified = [];

  for (const expected of expectedArtifacts) {
    const artifact = manifest.artifacts.find((candidate) => candidate.version === expected.version);
    invariant(artifact, `missing artifact ${expected.version}`);

    for (const field of ["filename", "sha256", "classification", "order"]) {
      invariant(artifact[field] === expected[field], `${expected.version} has unexpected ${field}`);
    }

    invariant(
      artifact.immutability?.startsWith("Frozen bytes."),
      `${expected.version} lacks the immutability declaration`,
    );
    invariant(
      typeof artifact.purpose === "string" && artifact.purpose.length > 0,
      `${expected.version} lacks a purpose`,
    );
    invariant(
      typeof artifact.replayInstruction === "string" && artifact.replayInstruction.length > 0,
      `${expected.version} lacks a replay instruction`,
    );
    invariant(Array.isArray(artifact.dependencies), `${expected.version} lacks dependencies`);
    assertStringArray(artifact.allowedEnvironments, `${expected.version}.allowedEnvironments`);
    assertStringArray(artifact.forbiddenEnvironments, `${expected.version}.forbiddenEnvironments`);
    invariant(
      artifact.allowedEnvironments.length === 1 &&
        artifact.allowedEnvironments[0] === requiredContext,
      `${expected.version} permits a non-local environment`,
    );
    for (const forbidden of ["production", "normal-db-push"]) {
      invariant(
        artifact.forbiddenEnvironments.includes(forbidden),
        `${expected.version} does not forbid ${forbidden}`,
      );
    }

    const artifactPath = path.join(
      repositoryRoot,
      manifest.artifactRoot,
      ...artifact.filename.split("/"),
    );
    const bytes = await readFile(artifactPath);
    const actualHash = sha256(bytes);
    invariant(
      actualHash === expected.sha256,
      `${expected.version} hash mismatch: expected ${expected.sha256}, received ${actualHash}`,
    );
    invariant(
      !operationalFiles.some((filename) => filename.startsWith(`${expected.version}_`)),
      `${expected.version} is present in the operational migration directory`,
    );
    const gitAttributePath = path.posix.join("/", manifest.artifactRoot, artifact.filename);
    invariant(
      gitAttributeRules.has(`${gitAttributePath} -text`),
      `${expected.version} is not protected from Git line-ending normalization`,
    );

    verified.push({
      version: expected.version,
      sha256: actualHash,
      classification: expected.classification,
      operationalCollision: false,
    });
  }

  const ordered = [...manifest.artifacts].sort((left, right) => left.order - right.order);
  invariant(
    ordered.every((artifact, index) => artifact === manifest.artifacts[index]),
    "artifacts are not stored in replay order",
  );
  invariant(
    typeof manifest.productionPolicy === "string" &&
      manifest.productionPolicy.includes("must never"),
    "production prohibition is missing",
  );

  return {
    context: requiredContext,
    manifest: manifestRelativePath.replaceAll(path.sep, "/"),
    verified,
    networkAccess: false,
    sqlExecuted: false,
    gitLineEndingNormalization: false,
  };
}

function parseCliArguments(args) {
  const expected = new Set(["--verify", `--context=${requiredContext}`]);
  invariant(args.length === expected.size, "exactly --verify and the local context are required");
  for (const argument of args) {
    invariant(expected.has(argument), `unsupported argument ${argument}`);
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    parseCliArguments(process.argv.slice(2));
    const result = await verifyStagingReplayArtifacts();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
