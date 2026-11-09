import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [resolve(import.meta.dirname, "../src/lib/studio-time.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { getStudioDateKey } = await import(moduleUrl);

test("date keys keep calendar days across Lisbon and New York daylight changes", () => {
  assert.equal(getStudioDateKey("2026-03-29T00:30:00Z", "Europe/Lisbon"), "2026-03-29");
  assert.equal(getStudioDateKey("2026-03-29T23:30:00Z", "Europe/Lisbon"), "2026-03-30");
  assert.equal(getStudioDateKey("2026-10-25T00:30:00Z", "Europe/Lisbon"), "2026-10-25");
  assert.equal(getStudioDateKey("2026-11-09T02:00:00Z", "America/New_York"), "2026-11-08");
  assert.equal(getStudioDateKey("2026-03-29T23:30:00Z", "invalid/timezone"), "2026-03-30");
});
