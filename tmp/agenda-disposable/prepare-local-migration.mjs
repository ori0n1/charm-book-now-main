import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const evidence = JSON.parse(readFileSync("tests/evidence/agenda-role-parity-readonly-20261029.json", "utf8"));
const signatures = Object.keys(evidence.functions);
const sql = `SELECT md5(pg_get_functiondef(to_regprocedure(signature))) FROM unnest(ARRAY[${signatures.map((signature) => `'public.${signature}'`).join(",")}]) AS signature`;
const actual = execFileSync("docker", ["exec", "supabase_db_bellza-agenda-disposable-20261029", "psql", "-U", "postgres", "-d", "postgres", "-Atqc", sql], { encoding: "utf8" }).trim().split(/\r?\n/);
assert.equal(actual.length, 11);
assert.ok(actual.every((hash) => /^[a-f0-9]{32}$/.test(hash)));
const source = readFileSync("supabase/migrations/20261029230000_agenda_role_parity.sql", "utf8");
assert.deepEqual(source.match(/v_expected_hashes text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1].match(/[a-f0-9]{32}/g), Object.values(evidence.functions));
const local = source.replace(/v_expected_hashes text\[\] := ARRAY\[[\s\S]*?\];/,
  `v_expected_hashes text[] := ARRAY[${actual.map((hash) => `'${hash}'`).join(",")}];`);
writeFileSync("tmp/agenda-disposable/agenda-candidate-local.sql", local);
console.log(`Local SQL copy prepared: ${actual.filter((hash, index) => hash === Object.values(evidence.functions)[index]).length}/11 original definitions match production hashes`);
