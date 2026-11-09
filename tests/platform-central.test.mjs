import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const bundle = await build({
  entryPoints: [resolve(projectRoot, "src/lib/platform-central-core.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "project-alias",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => ({
          path: resolve(projectRoot, "src", args.path.slice(2)) + ".ts",
        }));
      },
    },
  ],
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { buildCentralOverview } = await import(moduleUrl);

const now = new Date("2026-11-09T12:00:00.000Z");
const studio = {
  id: "studio-1",
  name: "Exemplo",
  owner_name: "Responsável",
  email: "owner@example.test",
  is_active: true,
  plan: "yearly",
  subscription_status: "trialing",
  trial_ends_at: "2026-11-09T09:00:00.000Z",
  created_at: "2026-10-01T12:00:00.000Z",
};
const appointment = {
  id: "appointment-1",
  studio_id: studio.id,
  status: "completed",
  starts_at: "2026-11-08T15:00:00.000Z",
  total_price: 25.5,
};
const invoice = (id, eventType) => ({
  id: `${id}-${eventType}`,
  event_type: eventType,
  created_at: "2026-11-08T12:00:00.000Z",
  payload: { data: { object: { id, amount_paid: 1300, currency: "eur" } } },
});

test("central counts an expired trial and deduplicates paid invoices", () => {
  const result = buildCentralOverview({
    studios: [studio],
    subscriptions: [],
    appointments: [appointment],
    billingEvents: [
      invoice("inv_1", "invoice.paid"),
      invoice("inv_1", "invoice.payment_succeeded"),
    ],
    now,
  });
  assert.equal(result.counts.trial, 1);
  assert.equal(result.counts.expiringTrials, 1);
  assert.equal(result.counts.paidActive, 0);
  assert.equal(result.billing.revenueCents, 1300);
  assert.equal(result.billing.paidInvoices, 1);
  assert.equal(result.activity.volumeCents, 2550);
  assert.equal(result.studios[0].plan, "yearly");
  assert.equal(result.studios[0].subscriptionStatus, "trialing");
});

test("failed optional reads remain unavailable instead of reporting zero", () => {
  const result = buildCentralOverview({
    studios: [studio],
    subscriptions: [],
    appointments: null,
    billingEvents: null,
    now,
  });
  assert.equal(result.activity, null);
  assert.equal(result.billing, null);
  assert.equal(result.studios[0].appointments, null);
  assert.equal(result.issues.length, 2);
});
