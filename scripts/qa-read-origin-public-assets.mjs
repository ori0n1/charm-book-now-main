// Bounded unauthenticated GET of static files from the verified source build.
// No cookies or form actions; compares only SHA256, never prints contents.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
const version = "9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8";
const source = resolve("../.capivara-agenda-fix/dist/client");
const targetRoot = resolve(`.bellza-agent-state/production-reference/${version}.public-assets`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function collect(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? collect(full) : entry.isFile() ? [full] : [];
  });
}
const allowed = /\.(?:js|css|jpg|jpeg|png|svg|txt|webmanifest|webp)$/i;
const paths = collect(source).map((path) => relative(source, path).replaceAll("\\", "/"))
  .filter((path) => allowed.test(path) && !path.split("/").some((piece) => piece.startsWith("."))).sort();
if (paths.length < 200 || paths.length > 250) throw new Error("SOURCE_ASSET_COUNT_UNEXPECTED");
const records = [];
let next = 0;
async function worker() {
  while (next < paths.length) {
    const path = paths[next++];
    const sourceBytes = readFileSync(resolve(source, path));
    const expected = sha(sourceBytes);
    const target = resolve(targetRoot, path);
    if (!target.startsWith(`${targetRoot}\\`)) throw new Error("INVALID_PATH");
    let bytes;
    let status = 200;
    if (existsSync(target)) bytes = readFileSync(target);
    else {
      const response = await fetch(`https://bellza.pt/${path}`, {
        method: "GET", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15_000),
      });
      status = response.status;
      if (response.ok) {
        const declared = Number(response.headers.get("content-length") ?? 0);
        if (declared > 2_000_000) throw new Error("ASSET_SIZE_LIMIT");
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 2_000_000) throw new Error("ASSET_SIZE_LIMIT");
        if (sha(bytes) === expected) {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, bytes, { flag: "wx", mode: 0o400 });
        }
      } else await response.body?.cancel();
      await new Promise((done) => setTimeout(done, 100));
    }
    records.push({ path, status, sameAsSource: bytes ? sha(bytes) === expected : false,
      bytes: bytes?.length ?? 0, sha256: bytes ? sha(bytes) : null });
  }
}
await Promise.all([worker(), worker(), worker()]);
records.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(resolve(targetRoot, "source-asset-check.json"), JSON.stringify({ version, records }, null, 2));
console.log(JSON.stringify({ version, checked: records.length,
  identical: records.filter((r) => r.sameAsSource).length,
  differences: records.filter((r) => !r.sameAsSource).map(({ path, status }) => ({ path, status })) }));
