import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260928160000_production_performance_advisor_hardening.sql",
  "utf8",
);

const publicViews = [
  "public_studios",
  "public_service_categories",
  "public_services",
  "public_staff",
  "public_staff_services",
  "public_upsell_offers",
];

test("public catalogue views use invoker security over narrow private functions", () => {
  for (const view of publicViews) {
    assert.match(
      migration,
      new RegExp(
        `CREATE OR REPLACE VIEW public\\.${view}\\s+WITH \\(security_barrier = true, security_invoker = true\\)`,
      ),
    );
    assert.match(
      migration,
      new RegExp(`FROM private\\.catalog_${view}\\(\\)`),
    );
  }

  assert.equal(
    (migration.match(/SECURITY DEFINER/g) ?? []).length,
    publicViews.length,
  );
  assert.equal(
    (migration.match(/SET search_path = ''/g) ?? []).length,
    publicViews.length,
  );
  assert.doesNotMatch(migration, /GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.(?:studios|services|staff)\s+TO\s+anon/i);
});

test("RLS optimization is fail-closed and preserves policy predicates", () => {
  assert.match(migration, /target_count NOT IN \(0, 59\)/);
  assert.match(migration, /ALTER POLICY %I ON %I\.%I/);
  assert.match(migration, /USING \(%s\)/);
  assert.match(migration, /WITH CHECK \(%s\)/);
  assert.match(migration, /\(select auth\.uid\(\)\)/);
  assert.match(migration, /\(select auth\.role\(\)\)/);
  assert.doesNotMatch(migration, /DROP POLICY/i);
  assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY/i);
});

test("migration contains only schema hardening and the proven workload indexes", () => {
  const expectedIndexes = [
    "idx_appointments_client_studio",
    "idx_appointments_staff_studio",
    "idx_appointment_services_service",
    "idx_services_category",
    "idx_staff_user",
    "idx_staff_services_service",
  ];

  for (const index of expectedIndexes) {
    assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`));
  }

  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});
