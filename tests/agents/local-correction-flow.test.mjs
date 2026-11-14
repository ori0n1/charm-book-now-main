import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync,
  rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { runLocalCorrectionFlow } from "../../agents/atlas.mjs";

const from = "11111111-1111-4111-8111-111111111111";
const to = "22222222-2222-4222-8222-222222222222";
const monitorId = "33333333-3333-4333-8333-333333333333";
const diagnoseId = "44444444-4444-4444-8444-444444444444";
const monitoring = { agent: "sentinela", runId: monitorId,
  status: "ATENCAO", reference: {
    officialRecordedVersion: from, observedVersion: to } };
const diagnosis = { agent: "sherlock", runId: diagnoseId,
  status: "DIAGNOSTICADO", source: { runId: monitorId },
  findings: [{ code: "OFFICIAL_RECORD_OUTDATED",
    causeStatus: "CONFIRMADA" }] };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "bellza-local-correction-"));
  t.after(() => {
    const target = realpathSync(dir);
    assert(target.startsWith(realpathSync(tmpdir()) + sep));
    rmSync(target, { recursive: true, force: true });
  });
  const repo = join(dir, "repo");
  const patches = join(dir, "patches");
  const stateDir = join(dir, "state");
  mkdirSync(join(repo, "agents"), { recursive: true });
  mkdirSync(join(repo, "tests", "agents"), { recursive: true });
  writeFileSync(join(repo, "agents", "reference.json"),
    JSON.stringify({ officialRecordedVersion: from, observedVersion: to },
      null, 2) + "\n");
  writeFileSync(join(repo, "tests", "agents", "phase6.test.mjs"),
    'throw new Error("UNTRUSTED_WORKTREE_CODE_EXECUTED");\n');
  const git = (...args) => execFileSync("git", args,
    { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic Bellza");
  git("config", "user.email", "synthetic@example.invalid");
  git("add", ".");
  git("commit", "-qm", "synthetic fixture");
  return { repo, patches, stateDir, commit: git("rev-parse", "HEAD") };
}

function input(f) {
  return { monitoring, diagnosis, repositoryRoot: f.repo,
    parentDir: f.patches, stateDir: f.stateDir,
    proof: { sourceVerified: true, from, to,
      sourceCommit: f.commit, diagnosisRunId: diagnoseId,
      monitorRunId: monitorId },
    active: { version: to, source: "CLOUDFLARE_OAUTH_READ_ONLY",
      candidateBaseVerified: true, bindingsMatch: true,
      runtimeMatch: true, cronsMatch: true,
      protectedFeaturesReviewed: true },
    rollback: { validated: true, version: to } };
}

test("Atlas prepara patch real só na worktree, executa teste e recebe parecer", (t) => {
  const f = fixture(t);
  const report = runLocalCorrectionFlow(input(f));
  assert.equal(report.status, "APTO");
  assert.equal(report.patch.appliedLocally, true);
  assert.equal(report.patch.remoteWrites, false);
  assert.equal(report.tests, "APPROVED");
  assert.equal(report.review.checks.find((item) =>
    item.name === "directed_local_tests").status, "PASS");
  assert.equal(report.review.publicationAuthorized, false);
  assert.equal(JSON.parse(readFileSync(join(f.repo, "agents",
    "reference.json"))).officialRecordedVersion, from);
  assert.equal(JSON.parse(readFileSync(join(report.patch.workspace,
    "agents", "reference.json"))).officialRecordedVersion, to);
  assert.equal(JSON.parse(readFileSync(join(f.stateDir, "flows",
    `${report.flowId}.json`))).review.status, "APTO");
});

test("causa incerta e origem não comprovada bloqueiam escrita local", (t) => {
  const f = fixture(t);
  const uncertain = runLocalCorrectionFlow({
    ...input(f), diagnosis: { ...diagnosis,
      findings: [{ ...diagnosis.findings[0],
        causeStatus: "NAO_DETERMINADA" }] } });
  assert.equal(uncertain.patch.status, "NOT_PREPARED");
  assert.equal(uncertain.status, "BLOQUEADO");
  const forged = runLocalCorrectionFlow({
    ...input(f), proof: { ...input(f).proof,
      sourceCommit: "0".repeat(40) } });
  assert.equal(forged.patch.status, "BLOCKED");
  assert.equal(forged.status, "BLOQUEADO");
});

test("Guardião mantém publicação bloqueada sem comparação ou rollback", (t) => {
  const f = fixture(t);
  const report = runLocalCorrectionFlow({
    ...input(f), active: null, rollback: null });
  assert.equal(report.patch.status, "LOCAL_PATCH_PREPARED");
  assert.equal(report.review.status, "INDETERMINADO");
  assert.equal(report.review.canaryAllowed, false);
  assert.equal(report.review.promotionAllowed, false);
});
