import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const bundle = await build({
  entryPoints: [resolve(projectRoot, "src/lib/platform-metrics-core.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "project-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => ({
        path: resolve(projectRoot, "src", args.path.slice(2)) + ".ts",
      }));
    },
  }],
});
const { buildPlatformMetrics } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const now = new Date("2026-11-09T12:00:00.000Z");
const filters = {
  studioId: null, preset: "30d", from: null, to: null,
  plan: "all", accountStatus: "all", subscriptionStatus: "all",
};
const studios = [
  { id: "active", name: "Ativo", is_active: true },
  { id: "owner", name: "Conta excluída", is_active: true },
  { id: "no-client", name: "Sem cliente", is_active: true },
  { id: "no-volume", name: "Sem volume", is_active: true },
  { id: "blocked", name: "Bloqueado", is_active: false },
].map((studio) => ({ ...studio, plan: "trial", subscription_status: "trialing", trial_ends_at: "2026-11-12T12:00:00Z", created_at: "2026-10-01T12:00:00Z" }));
const appointment = (studio_id, total_price) => ({
  id: studio_id, studio_id, status: "completed", total_price,
  starts_at: "2026-11-08T12:00:00Z", created_at: "2026-11-08T12:00:00Z",
});
const input = {
  filters, studios, subscriptions: [],
  appointments: [appointment("active", 25), appointment("owner", 10), appointment("no-client", 30),
    appointment("no-volume", 0), appointment("blocked", 40)],
  clients: ["active", "owner", "no-volume", "blocked"].map((studio_id) => ({
    id: `client-${studio_id}`, studio_id, created_at: "2026-11-01T12:00:00Z",
  })),
  billingEvents: [], identities: [], excludedStudioIds: ["owner"], now,
};

test("general metrics count only operational studios with clients and positive volume", () => {
  const result = buildPlatformMetrics(input);
  assert.equal(result.studios.total, 2);
  assert.equal(result.studios.active, 2);
  assert.equal(result.studios.trial, 2);
  assert.equal(result.clients.total, 2);
  assert.equal(result.finances.studioVolumeCents, 2500);
  assert.equal(result.finances.averageAppointmentCents, 2500);
  assert.deepEqual(result.rankings.byVolume.map((row) => row.id), ["active"]);
  const day = result.timeline.find((point) => point.key === "2026-11-08");
  assert.equal(day?.appointments, 2);
  assert.equal(day?.studioVolumeCents, 2500);
});

test("an explicitly selected studio remains inspectable, including its own volume", () => {
  const result = buildPlatformMetrics({ ...input, filters: { ...filters, studioId: "owner" } });
  assert.equal(result.studios.total, 1);
  assert.equal(result.finances.studioVolumeCents, 1000);
  assert.equal(result.selectedStudio?.id, "owner");
});

test("monthly timeline places qualified studios and volume in their actual months", () => {
  const result = buildPlatformMetrics({ ...input, filters: { ...filters, preset: "year" } });
  const october = result.timeline.find((point) => point.key === "2026-10");
  const november = result.timeline.find((point) => point.key === "2026-11");
  assert.equal(october?.studios, 2);
  assert.equal(october?.trials, 2);
  assert.equal(november?.appointments, 2);
  assert.equal(november?.studioVolumeCents, 2500);
});
