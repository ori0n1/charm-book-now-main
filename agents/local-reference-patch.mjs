import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync,
  writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { prepareReferencePatchWorkspace } from "./telegram-gateway/patch-worktree.mjs";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;

// A fixed recipe for the agent reference only. Never accepts a file path or
// replacement body from a model. The application source is untouched.
export function prepareLocalReferencePatch({ repositoryRoot, parentDir,
  taskId, proof, diagnosis, proposal } = {}) {
  if (!UUID.test(taskId ?? "") ||
      diagnosis?.agent !== "sherlock" ||
      diagnosis.status !== "DIAGNOSTICADO" ||
      diagnosis.findings?.length !== 1 ||
      diagnosis.findings[0].code !== "OFFICIAL_RECORD_OUTDATED" ||
      diagnosis.findings[0].causeStatus !== "CONFIRMADA" ||
      proposal?.agent !== "forge" || proposal.status !== "PROPOSTA" ||
      proposal.source !== diagnosis.runId ||
      proposal.plan?.scope?.length !== 1 ||
      proposal.plan.scope[0] !== "agents/reference.json" ||
      proposal.proposedPatch?.file !== "agents/reference.json" ||
      proposal.proposedPatch.from !== proof?.from ||
      proposal.proposedPatch.to !== proof?.to ||
      proof?.sourceVerified !== true ||
      proof?.diagnosisRunId !== diagnosis.runId ||
      proof?.monitorRunId !== diagnosis.source?.runId ||
      !SHA.test(proof?.sourceCommit ?? ""))
    throw new Error("LOCAL_PATCH_PROOF_REQUIRED");
  const result = prepareReferencePatchWorkspace({ repositoryRoot, parentDir,
    taskId, proof });
  if (result.sourceCommit !== proof.sourceCommit)
    throw new Error("LOCAL_PATCH_SOURCE_CHANGED");
  const workspace = resolve(parentDir, taskId);
  if (!workspace.startsWith(resolve(parentDir) + sep))
    throw new Error("LOCAL_PATCH_PATH_DENIED");
  const path = join(workspace, "agents", "reference.json");
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() ||
      !realpathSync(path).startsWith(realpathSync(workspace) + sep))
    throw new Error("LOCAL_PATCH_PATH_DENIED");
  const before = readFileSync(path, "utf8");
  const old = `"officialRecordedVersion": "${proof.from}"`;
  if (before.split(old).length !== 2)
    throw new Error("LOCAL_PATCH_REFERENCE_UNVERIFIED");
  const after = before.replace(old,
    `"officialRecordedVersion": "${proof.to}"`);
  const parsed = JSON.parse(after);
  if (parsed.officialRecordedVersion !== proof.to ||
      parsed.observedVersion !== proof.to)
    throw new Error("LOCAL_PATCH_REFERENCE_UNVERIFIED");
  writeFileSync(path, after, { flag: "w" });
  return { status: "LOCAL_PATCH_PREPARED", file: "agents/reference.json",
    taskId, workspace, sourceCommit: result.sourceCommit,
    beforeSha256: createHash("sha256").update(before).digest("hex"),
    afterSha256: createHash("sha256").update(after).digest("hex"),
    appliedLocally: true, remoteWrites: false,
    publicationAuthorized: false };
}
