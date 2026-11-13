import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const VERSION = UUID;
function git(root, args, hooksDir) {
  const result = spawnSync("git", ["-c", `core.hooksPath=${hooksDir}`,
    "-C", root, ...args], { encoding: "utf8", windowsHide: true,
    shell: false, timeout: 15_000, maxBuffer: 64_000 });
  if (result.status !== 0 || result.error)
    throw new Error("PATCH_WORKTREE_GIT_UNAVAILABLE");
  return result.stdout.trim();
}
function patchFor(body, from, to) {
  const lines = body.trimEnd().split(/\r?\n/);
  const matches = lines.filter((line) =>
    /^\s*"officialRecordedVersion": "[0-9a-f-]{36}",?$/.test(line));
  if (matches.length !== 1 || !matches[0].includes(`"${from}"`))
    throw new Error("PATCH_REFERENCE_UNVERIFIED");
  const old = matches[0];
  const target = old.replace(`"${from}"`, `"${to}"`);
  const out = ["diff --git a/agents/reference.json b/agents/reference.json",
    "--- a/agents/reference.json", "+++ b/agents/reference.json",
    `@@ -1,${lines.length} +1,${lines.length} @@`];
  for (const line of lines) {
    if (line === old) out.push(`-${old}`, `+${target}`);
    else out.push(` ${line}`);
  }
  return out.join("\n") + "\n";
}
export function prepareReferencePatchWorkspace({ repositoryRoot, parentDir,
  taskId, proof } = {}) {
  if (!isAbsolute(repositoryRoot ?? "") || !isAbsolute(parentDir ?? "") ||
      !UUID.test(taskId ?? "") || proof?.sourceVerified !== true ||
      !VERSION.test(proof.from ?? "") || !VERSION.test(proof.to ?? "") ||
      proof.from === proof.to)
    throw new Error("PATCH_PROOF_INVALID");
  const repo = resolve(repositoryRoot);
  const parent = resolve(parentDir);
  const workspace = join(parent, taskId);
  if (existsSync(workspace)) throw new Error("PATCH_WORKTREE_EXISTS");
  mkdirSync(parent, { recursive: true });
  const hooksDir = join(parent, "empty-hooks");
  mkdirSync(hooksDir, { recursive: true });
  if (git(repo, ["status", "--porcelain", "--untracked-files=no"], hooksDir))
    throw new Error("PATCH_SOURCE_DIRTY");
  const head = git(repo, ["rev-parse", "HEAD"], hooksDir);
  if (!/^[0-9a-f]{40}$/.test(head))
    throw new Error("PATCH_SOURCE_INVALID");
  const source = JSON.parse(readFileSync(join(repo, "agents", "reference.json"),
    "utf8"));
  if (source.officialRecordedVersion !== proof.from ||
      source.observedVersion !== proof.to)
    throw new Error("PATCH_REFERENCE_UNVERIFIED");
  git(repo, ["worktree", "add", "--detach", workspace, head], hooksDir);
  const body = readFileSync(join(workspace, "agents", "reference.json"),
    "utf8");
  const patch = patchFor(body, proof.from, proof.to);
  writeFileSync(join(workspace, "proposal.patch"), patch,
    { mode: 0o600, flag: "wx" });
  writeFileSync(join(workspace, "proposal.json"), JSON.stringify({
    schema: 1, taskId, sourceCommit: head, file: "agents/reference.json",
    from: proof.from, to: proof.to, applied: false,
    productionAuthorized: false, publicationAuthorized: false,
  }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return { source: "LOCAL_WORKTREE", status: "PROPOSTA_LOCAL",
    applied: false, workspaceId: taskId, sourceCommit: head };
}
