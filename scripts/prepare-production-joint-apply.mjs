import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationsDir = join(root, "supabase/migrations");
const files = readdirSync(migrationsDir).filter((name) => /^20261019\d+_.+\.sql$/.test(name)).sort();
if (files.length !== 13) throw new Error("joint_migration_set_changed");
const hash = createHash("sha256");
for (const name of files) {
  hash.update(name);
  hash.update(readFileSync(join(migrationsDir, name)));
}
const manifest = JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8"));
if (hash.digest("hex") !== manifest.migrationsSha256) throw new Error("joint_migrations_changed");

const preflight = readFileSync(join(root, "validation-production-schema-rollback.sql"), "utf8")
  .replaceAll("\r\n", "\n");
if (!preflight.startsWith("BEGIN;\nSET LOCAL lock_timeout = '2s';\nSET LOCAL statement_timeout = '30s';") ||
    !/ROLLBACK;\s*$/.test(preflight)) throw new Error("production_preflight_changed");
let offset = 0;
for (const name of files) {
  const sql = readFileSync(join(migrationsDir, name), "utf8").replaceAll("\r\n", "\n").trim();
  const at = preflight.indexOf(sql, offset);
  if (at < offset) throw new Error(`migration_missing_from_preflight:${name}`);
  offset = at + sql.length;
}

const migrationRows = files.map((name) => {
  const [, version, migrationName] = name.match(/^(\d+)_([a-z0-9_]+)\.sql$/) ?? [];
  if (!version || !migrationName) throw new Error(`invalid_migration_name:${name}`);
  return `('${version}', '${migrationName}')`;
});
const apply = preflight.replace(/ROLLBACK;\s*$/, [
  "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES",
  `  ${migrationRows.join(",\n  ")};`,
  "COMMIT;",
  "",
].join("\n"));
const output = join(root, "production-apply-joint.sql");
writeFileSync(output, apply);
console.log(JSON.stringify({ file: output, migrations: files.length,
  sha256: createHash("sha256").update(apply).digest("hex") }));
