import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [resolve(import.meta.dirname, "../src/lib/platform-central-access-core.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { buildCentralAccessSnapshot, centralVolumeWithoutAccount } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const now = new Date("2026-11-09T12:00:00.000Z");

test("counts linked studio logins, separates never signed in, and excludes only owned studios", () => {
  const users = [
    { id: "silas", email: "SILAS18.SO@GMAIL.COM", last_sign_in_at: "2026-11-09T10:00:00Z" },
    { id: "owner-old", email: "old@example.test", last_sign_in_at: "2026-10-09T10:00:00Z" },
    { id: "staff-current", email: "staff@example.test", last_sign_in_at: "2026-11-08T10:00:00Z" },
    { id: "owner-never", email: "never@example.test", last_sign_in_at: null },
  ];
  const roles = [
    { user_id: "silas", studio_id: "silas-studio", role: "studio_owner" },
    { user_id: "silas", studio_id: "other-studio", role: "staff" },
    { user_id: "owner-old", studio_id: "old-studio", role: "studio_owner" },
    { user_id: "owner-old", studio_id: "current-studio", role: "studio_owner" },
    { user_id: "staff-current", studio_id: "current-studio", role: "staff" },
    { user_id: "owner-never", studio_id: "never-studio", role: "studio_owner" },
  ];
  const access = buildCentralAccessSnapshot({ users, roles, now });
  assert.deepEqual(access.excludedStudioIds, ["silas-studio"]);
  assert.equal(access.studios.find((row) => row.studioId === "old-studio").state, "inactive");
  assert.equal(access.studios.find((row) => row.studioId === "current-studio").state, "recent");
  assert.equal(access.studios.find((row) => row.studioId === "never-studio").state, "never");
  assert.deepEqual(centralVolumeWithoutAccount([
    { id: "silas-studio", volumeCents: 2500 },
    { id: "old-studio", volumeCents: 4000 },
  ], access), { visibleCents: 4000, excludedCents: 2500 });
  assert.deepEqual(centralVolumeWithoutAccount([
    { id: "silas-studio", volumeCents: 2500 },
    { id: "old-studio", volumeCents: 4000 },
    { id: "unqualified", volumeCents: 500 },
  ], access, new Set(["old-studio"])), { visibleCents: 4000, excludedCents: 2500 });
});

test("hides total when exclusion identity or matching studio is unavailable", () => {
  const missing = buildCentralAccessSnapshot({ users: [], roles: [], now });
  assert.equal(centralVolumeWithoutAccount([{ id: "one", volumeCents: 100 }], missing), null);
  const owned = buildCentralAccessSnapshot({
    users: [{ id: "silas", email: "silas18.so@gmail.com" }],
    roles: [{ user_id: "silas", studio_id: "owned", role: "studio_owner" }],
    now,
  });
  assert.equal(centralVolumeWithoutAccount([{ id: "other", volumeCents: 100 }], owned), null);
  assert.equal(centralVolumeWithoutAccount([{ id: "owned", volumeCents: null }], owned), null);
});

test("a role without an auth user is unknown, not never signed in", () => {
  const result = buildCentralAccessSnapshot({
    users: [{ id: "silas", email: "silas18.so@gmail.com" }],
    roles: [{ user_id: "missing", studio_id: "one", role: "studio_owner" }],
    now,
  });
  assert.equal(result.studios[0].state, "unknown");
});
