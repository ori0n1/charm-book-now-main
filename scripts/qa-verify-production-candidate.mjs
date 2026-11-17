// Reproducible local QA candidate check. Reads the immutable active Worker
// reference, the verified source build and this worktree's production build.
// No remote calls, secrets, data queries or writes.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const version = "9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8";
const referenceRoot = resolve(".bellza-agent-state/production-reference");
const originRoot = resolve("../.capivara-agenda-fix/dist");
const candidateRoot = resolve("dist");
const manifest = JSON.parse(readFileSync(resolve(referenceRoot, `${version}.manifest.json`)));
const raw = readFileSync(resolve(referenceRoot, `${version}.multipart`));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assert = (condition, code) => { if (!condition) throw new Error(code); };
assert(manifest.versionId === version && sha(raw) === manifest.rawSha256, "ACTIVE_REFERENCE_INVALID");
const form = await new Response(raw, { headers: { "content-type": manifest.contentType } }).formData();
const active = new Map();
for (const [, value] of form) {
  if (typeof value !== "string" && value.name.endsWith(".js")) {
    const bytes = Buffer.from(await value.arrayBuffer());
    assert(manifest.parts.find((p) => p.filename === value.name)?.sha256 === sha(bytes), "ACTIVE_PART_INVALID");
    active.set(value.name, bytes);
  }
}
function collect(root, path = root) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? collect(root, full) : entry.isFile()
      ? [relative(root, full).replaceAll("\\", "/")] : [];
  });
}
const originModules = collect(resolve(originRoot, "server")).filter((v) => v.endsWith(".js"));
const candidateModules = collect(resolve(candidateRoot, "server")).filter((v) => v.endsWith(".js"));
assert(active.size === 229 && originModules.length === 229 && candidateModules.length === 230, "MODULE_COUNT_DRIFT");
assert(originModules.every((name) => active.has(name) &&
  sha(readFileSync(resolve(originRoot, "server", name))) === sha(active.get(name))), "ORIGIN_WORKER_MISMATCH");
const normalize = (bytes) => bytes.toString("utf8")
  .replace(/^import "\.\/qa-public-visibility-[A-Za-z0-9_-]{8}\.js";\r?\n/gm, "")
  .replace(/-[A-Za-z0-9_-]{8}(?=\.(?:js|css)(?:["'`?]|$))/g, "-HASH");
const stem = (name) => name.replace(/-[A-Za-z0-9_-]{8}\.js$/, ".js");
const grouped = (names, get) => {
  const map = new Map();
  for (const name of names) {
    const key = stem(name);
    const values = map.get(key) ?? [];
    values.push(sha(normalize(get(name))));
    map.set(key, values);
  }
  for (const values of map.values()) values.sort();
  return map;
};
const activeGroups = grouped([...active.keys()], (name) => active.get(name));
const candidateGroups = grouped(candidateModules, (name) => readFileSync(resolve(candidateRoot, "server", name)));
const different = [...new Set([...activeGroups.keys(), ...candidateGroups.keys()])].sort()
  .filter((name) => JSON.stringify(activeGroups.get(name)) !== JSON.stringify(candidateGroups.get(name)));
const expected = ["assets/_tanstack-start-manifest_v.js", "assets/public-booking.functions.js",
  "assets/public-studio.functions.js", "assets/qa-public-visibility.js", "assets/router.js"];
assert(JSON.stringify(different) === JSON.stringify(expected), "UNEXPECTED_WORKER_DIFFERENCES");
const originStatic = collect(resolve(originRoot, "client")).sort();
const candidateStatic = collect(resolve(candidateRoot, "client")).sort();
assert(originStatic.length === 223 && JSON.stringify(originStatic) === JSON.stringify(candidateStatic), "STATIC_INVENTORY_DRIFT");
assert(originStatic.every((name) => sha(readFileSync(resolve(originRoot, "client", name))) ===
  sha(readFileSync(resolve(candidateRoot, "client", name)))), "STATIC_CONTENT_DRIFT");
const activeRouteManifest = [...active].find(([name]) => name.startsWith("assets/_tanstack-start-manifest_v-"))?.[1];
const candidateRouteManifest = candidateModules.find((name) => name.startsWith("assets/_tanstack-start-manifest_v-"));
const routes = (value) => [...new Set([...value.toString("utf8").matchAll(/(?:__root__|"([^"]+)"):\s*\{\s*filePath:/g)]
  .map((v) => v[1] ?? "__root__"))].sort();
const activeRoutes = routes(activeRouteManifest);
assert(activeRoutes.length === 45 && JSON.stringify(activeRoutes) ===
  JSON.stringify(routes(readFileSync(resolve(candidateRoot, "server", candidateRouteManifest)))), "ROUTE_DRIFT");
const sourceChanges = execFileSync("git", ["diff", "--name-only", "4598a4f2cd422309599a1e37458c8e49b27b861a", "--", "src"],
  { encoding: "utf8" }).trim().split(/\r?\n/).sort();
const expectedSource = ["src/lib/public-booking.functions.ts", "src/lib/public-studio.functions.ts",
  "src/lib/qa-public-visibility.ts", "src/routes/api/public/studio-manifest.$slug.ts", "src/routes/sitemap[.]xml.ts"].sort();
assert(JSON.stringify(sourceChanges) === JSON.stringify(expectedSource), "SOURCE_DIFF_OUTSIDE_QA_SCOPE");
console.log(JSON.stringify({ activeVersion: version, originModulesIdentical: 229,
  candidateModules: 230, normalizedDifferences: different, staticFilesIdentical: 223,
  routesIdentical: 45, changedSourceFiles: sourceChanges }, null, 2));
