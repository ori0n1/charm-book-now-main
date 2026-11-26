import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const baseline = resolve("../.clients-whatsapp-status-menu-20261126/dist");
const candidate = resolve("dist");
const sha = (value) => createHash("sha256").update(value).digest("hex");
function files(root, prefix = "") {
  const result = new Map();
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      for (const [name, hash] of files(root, `${path}/`)) result.set(name, hash);
    } else if (entry.isFile() && !path.includes("/.wrangler/") && path !== "server/wrangler.client-profile.production.json") {
      result.set(path, sha(readFileSync(join(root, path))));
    }
  }
  return result;
}
const before = files(baseline);
const after = files(candidate);
const unchanged = [...before.keys()].filter((path) => after.get(path) === before.get(path));
const changed = [...before.keys()].filter((path) => after.has(path) && after.get(path) !== before.get(path));
const removed = [...before.keys()].filter((path) => !after.has(path));
const added = [...after.keys()].filter((path) => !before.has(path));
const groups = (paths) => ({
  workerModules: paths.filter((path) => path.startsWith("server/assets/") || path === "server/index.js").length,
  clientAssets: paths.filter((path) => path.startsWith("client/assets/")).length,
  other: paths.filter((path) => !path.startsWith("server/assets/") && path !== "server/index.js" && !path.startsWith("client/assets/")).length,
});
const manifest = [...after].sort(([a], [b]) => a.localeCompare(b));
const buildConfig = (root) => {
  const config = JSON.parse(readFileSync(join(root, "server/wrangler.json"), "utf8"));
  delete config.configPath;
  delete config.userConfigPath;
  return config;
};
const buildConfigEquivalent = JSON.stringify(buildConfig(baseline)) === JSON.stringify(buildConfig(candidate));
const report = {
  baselineCount: before.size, candidateCount: after.size,
  unchanged: groups(unchanged), changed: groups(changed), removed: groups(removed), added: groups(added),
  removedFiles: removed.sort(), addedFiles: added.sort(), changedFiles: changed.sort(),
  candidateManifestSha256: sha(JSON.stringify(manifest)),
  buildConfigEquivalent,
};
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/manual-appointment-artifact-diff.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ baselineCount: report.baselineCount, candidateCount: report.candidateCount,
  unchanged: report.unchanged, changed: report.changed, removed: report.removed, added: report.added,
  buildConfigEquivalent,
  candidateManifestSha256: report.candidateManifestSha256,
  report: "artifacts/manual-appointment-artifact-diff.json" }));
if (!buildConfigEquivalent || before.size < 450 || removed.some((path) => !path.startsWith("client/assets/") && !path.startsWith("server/assets/")) ||
  added.some((path) => !path.startsWith("client/assets/") && !path.startsWith("server/assets/"))) process.exitCode = 1;
