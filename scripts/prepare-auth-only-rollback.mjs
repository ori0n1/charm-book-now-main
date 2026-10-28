import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const candidate = join(import.meta.dirname, "..");
const repoRoot = join(candidate, "../..");
const baseline = join(candidate, "../agenda-ux-20261024-candidate");
const output = join(candidate, "rollback/auth-only-source");
const patch = join(candidate, "rollback/retain-booking-auth.patch");
const baselineConfig = join(baseline, "dist/server/wrangler.agenda-ux.json");
const candidateConfig = join(candidate, "dist/server/wrangler.public-mobile-auth.json");
const configCopy = join(candidate, "rollback/worker-config-712.json");
const entries = ["src", "public", "scripts", "supabase", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "wrangler.jsonc", "wrangler.production.jsonc", "components.json", ".prettierrc"];
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const normalizedSourceHash = (path) => createHash("sha256")
  .update(readFileSync(path, "utf8").replaceAll("\r\n", "\n")).digest("hex");

if (hash(baselineConfig) !== hash(candidateConfig)) throw new Error("Candidate config differs from 712");
if (!existsSync(output)) {
  mkdirSync(output, { recursive: true });
  for (const entry of entries) cpSync(join(baseline, entry), join(output, entry), { recursive: true });
  const relativeOutput = relative(repoRoot, output).replaceAll("\\", "/");
  execFileSync("git", ["apply", `--directory=${relativeOutput}`, patch], { cwd: repoRoot, windowsHide: true });
}

const bookingFile = "src/lib/public-booking.functions.ts";
if (normalizedSourceHash(join(output, bookingFile)) !== normalizedSourceHash(join(candidate, bookingFile))) {
  throw new Error("Rollback auth guard differs from the candidate");
}
function verify(directory, prefix = "") {
  for (const entry of readdirSync(join(baseline, directory), { withFileTypes: true })) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) verify(child);
    else if (entry.isFile() && child.replaceAll("\\", "/") !== bookingFile &&
      hash(join(baseline, child)) !== hash(join(output, child))) {
      throw new Error(`Unexpected rollback source difference: ${child}`);
    }
  }
}
for (const entry of entries) {
  if (statSync(join(baseline, entry)).isDirectory()) verify(entry);
  else if (hash(join(baseline, entry)) !== hash(join(output, entry))) {
    throw new Error(`Unexpected rollback source difference: ${entry}`);
  }
}
cpSync(baselineConfig, configCopy);
writeFileSync(join(candidate, "rollback/source-manifest.json"), JSON.stringify({
  baseVersion: "23c9a8c4-e331-4f47-97ce-13cf0955010d",
  sourceDirectory: "auth-only-source",
  changedSourceFiles: [bookingFile],
  authFileNormalizedSha256: normalizedSourceHash(join(output, bookingFile)),
  workerConfigSha256: hash(configCopy),
}, null, 2) + "\n");
console.log("Rollback source prepared: 712 plus one auth-guard file; config hash matches 712.");
