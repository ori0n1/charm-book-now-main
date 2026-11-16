import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isExcludedQaStudio } from "../src/lib/qa-public-visibility.ts";

test("only the two permanent QA identities are hidden from public discovery", () => {
  for (const studio of [
    { id: "e2663064-7774-41c5-95cb-e5e6afc4fab4", slug: "bellza-qa-e2663064" },
    { id: "2cc1683e-ab91-4488-a702-6a8feb60f379", slug: "bellza-qa-b" },
    { slug: "BELLZA-QA-B" },
    { id: "2CC1683E-AB91-4488-A702-6A8FEB60F379" },
  ]) assert.equal(isExcludedQaStudio(studio), true);

  for (const studio of [
    { id: "00000000-0000-4000-8000-000000000001", slug: "studio-27" },
    { slug: "capivara" },
    { slug: "bellza-qa-b-outro" },
    {},
  ]) assert.equal(isExcludedQaStudio(studio), false);
});

test("catalog migration and rollback use the same six verified definitions and QA IDs", () => {
  const migration = readFileSync(new URL("../docs/qa-public-catalog-proposal.sql", import.meta.url), "utf8");
  const rollback = readFileSync(new URL("../docs/qa-public-catalog-rollback-proposal.sql", import.meta.url), "utf8");
  const baseline = (sql) => JSON.parse(sql.match(/baseline jsonb := '(\{[\s\S]*?\})'::jsonb;/)?.[1] ?? "null");
  const expected = baseline(migration);
  assert.equal(Object.keys(expected).length, 6);
  assert.deepEqual(baseline(rollback), expected);
  for (const id of ["e2663064-7774-41c5-95cb-e5e6afc4fab4", "2cc1683e-ab91-4488-a702-6a8feb60f379"]) {
    assert.equal(migration.includes(id), true);
    assert.equal(rollback.includes(id), true);
  }
  assert.match(rollback, /rollback would expose an active QA studio/);
});
