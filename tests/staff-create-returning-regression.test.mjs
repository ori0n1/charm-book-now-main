import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/routes/_authenticated/admin.equipa.tsx", "utf8");

const writeBlock = route.slice(
  route.indexOf("const id = staff?.id ?? crypto.randomUUID()"),
  route.indexOf("await supabase.from(\"staff_services\").delete()"),
);

test("new staff gets a client-generated UUID and is inserted without RETURNING", () => {
  assert.match(route, /const id = staff\?\.id \?\? crypto\.randomUUID\(\)/);
  assert.match(route, /\.from\("staff"\)\.insert\(\{ id, \.\.\.payload \}\)/);
  assert.doesNotMatch(writeBlock, /\.select\("id"\)/);
  assert.doesNotMatch(writeBlock, /\.single\(\)/);
});

test("staff updates avoid the unnecessary RETURNING path", () => {
  assert.match(route, /\.from\("staff"\)\.update\(payload\)\.eq\("id", id\)/);
  assert.doesNotMatch(writeBlock, /\.update\(payload\)[\s\S]*?\.select\(/);
});

test("the generated UUID is reused by service associations", () => {
  assert.match(route, /\.from\("staff_services"\)\.delete\(\)\.eq\("staff_id", id\)/);
  assert.match(
    route,
    /\.insert\(serviceIds\.map\(\(sid\) => \(\{ staff_id: id, service_id: sid \}\)\)\)/,
  );
});

test("the modal receives the current authenticated studio id", () => {
  assert.match(route, /studioId=\{studio\.id\}/);
  assert.match(route, /studio_id: studioId/);
});
