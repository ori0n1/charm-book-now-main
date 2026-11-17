// Read-only acquisition of the Worker receiving 100% traffic. Never prints
// OAuth credentials, binding values, script contents, or multipart payloads.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectReadOnlyOAuth } from "../agents/monitor-auth.mjs";
import { readOAuthToken } from "../agents/transport.mjs";

const ACCOUNT = "5c4cb61495df81feda4da7d1098e098e";
const SCRIPT = "tanstack-start-app";
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`;
const stateDir = resolve(".bellza-agent-state", "production-reference");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const auth = inspectReadOnlyOAuth();
if (auth.status !== "READ_ONLY_SCOPES" || Date.parse(auth.expiration) <= Date.now()) {
  throw new Error("READ_ONLY_OAUTH_UNAVAILABLE");
}
const headers = { Authorization: `Bearer ${readOAuthToken()}` };
async function read(path, json = true) {
  const response = await fetch(`${BASE}${path}`, {
    method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`CLOUDFLARE_GET_${response.status}`);
  if (!json) return response;
  const body = await response.json();
  if (body?.success !== true) throw new Error("CLOUDFLARE_RESULT_INVALID");
  return body.result;
}

const deployments = await read("/deployments");
const traffic = deployments.deployments?.[0]?.versions ?? [];
const active = traffic.filter((item) => item.percentage === 100);
if (active.length !== 1) throw new Error("ACTIVE_TRAFFIC_AMBIGUOUS");
const versionId = active[0].version_id;
if (!/^[0-9a-f-]{36}$/.test(versionId)) throw new Error("ACTIVE_VERSION_INVALID");
const version = await read(`/versions/${versionId}`);
if (version.id !== versionId || !/^[0-9a-f]{64}$/.test(version.resources?.script?.etag ?? "")) {
  throw new Error("ACTIVE_VERSION_METADATA_INVALID");
}
const response = await read("/content/v2", false);
const etag = response.headers.get("etag")?.replace(/^"|"$/g, "");
const contentType = response.headers.get("content-type") ?? "";
if (etag !== version.resources.script.etag || !/^multipart\/form-data; boundary=/i.test(contentType)) {
  await response.body?.cancel();
  throw new Error("ACTIVE_CONTENT_ETAG_MISMATCH");
}
const raw = Buffer.from(await response.arrayBuffer());
if (!raw.length || raw.length > 80_000_000) throw new Error("ACTIVE_CONTENT_SIZE_INVALID");
const form = await new Response(raw, { headers: { "content-type": contentType } }).formData();
const parts = [];
for (const [field, value] of form) {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(await value.arrayBuffer());
  parts.push({ field, filename: typeof value === "string" ? null : value.name,
    size: bytes.length, sha256: sha256(bytes) });
}
parts.sort((a, b) => (a.filename ?? a.field).localeCompare(b.filename ?? b.field));
if (parts.length < 2) throw new Error("ACTIVE_MULTIPART_INVALID");
const manifest = { schema: 1, account: ACCOUNT, script: SCRIPT, versionId,
  scriptEtag: etag, contentType, rawSize: raw.length, rawSha256: sha256(raw), parts };
mkdirSync(stateDir, { recursive: true });
const rawPath = resolve(stateDir, `${versionId}.multipart`);
const manifestPath = resolve(stateDir, `${versionId}.manifest.json`);
if (existsSync(rawPath)) {
  if (sha256(readFileSync(rawPath)) !== manifest.rawSha256) throw new Error("SAVED_REFERENCE_HASH_MISMATCH");
} else {
  writeFileSync(rawPath, raw, { flag: "wx", mode: 0o400 });
  chmodSync(rawPath, 0o400);
}
if (existsSync(manifestPath)) {
  const saved = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (saved.rawSha256 !== manifest.rawSha256) throw new Error("SAVED_MANIFEST_HASH_MISMATCH");
} else {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o400 });
  chmodSync(manifestPath, 0o400);
}
console.log(JSON.stringify({ versionId, scriptEtag: etag, rawSha256: manifest.rawSha256,
  rawSize: raw.length, partCount: parts.length, stored: true }));
