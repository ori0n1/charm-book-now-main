import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const base = join(import.meta.dirname, "../../agenda-ux-20261024-candidate");
const candidate = join(import.meta.dirname, "..");
const roots = ["src", "public", "supabase", "scripts", "tests"];
const rootFiles = ["package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "wrangler.jsonc", "wrangler.production.jsonc"];

function collect(root, path, target) {
  for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    const item = join(path, entry.name);
    if (entry.isDirectory()) collect(root, item, target);
    else if (entry.isFile()) {
      const content = readFileSync(join(root, item));
      target.set(item.replaceAll("\\", "/"), createHash("sha256").update(content).digest("hex"));
    }
  }
}

const before = new Map();
const after = new Map();
for (const root of roots) { collect(base, root, before); collect(candidate, root, after); }
for (const file of rootFiles) {
  for (const [directory, target] of [[base, before], [candidate, after]]) {
    const full = join(directory, file);
    if (statSync(full, { throwIfNoEntry: false })?.isFile()) {
      target.set(file, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  }
}

const modified = [...before.keys()].filter((file) => after.has(file) && before.get(file) !== after.get(file));
const removed = [...before.keys()].filter((file) => !after.has(file));
const added = [...after.keys()].filter((file) => !before.has(file));
const expectedProductFiles = [
  "src/components/booking-experience.tsx",
  "src/lib/public-booking.functions.ts",
  "src/lib/public-booking-selection.ts",
  "src/lib/public-mobile-environment.ts",
];
const productChanges = [...modified, ...added, ...removed].filter((file) => file.startsWith("src/")).sort();
const unexpectedProductFiles = productChanges.filter((file) => !expectedProductFiles.includes(file));
console.log(JSON.stringify({
  base: relative(candidate, base).replaceAll("\\", "/"),
  modified: modified.sort(),
  added: added.sort(),
  removed: removed.sort(),
  unexpectedProductFiles,
}, null, 2));
if (removed.length || unexpectedProductFiles.length || modified.some((file) => !file.startsWith("src/"))) process.exitCode = 1;
