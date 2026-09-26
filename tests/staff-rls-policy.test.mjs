import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const planMigrationPath = "supabase/migrations/20260907200000_free_pro_premium_entitlements.sql";
const premiumMigrationPath = "supabase/migrations/20260601170000_enforce_premium_access.sql";
const tenantMigrationPath = "supabase/migrations/20260919140000_tenant_relationship_integrity.sql";
const routePath = "src/routes/_authenticated/admin.equipa.tsx";

const [planMigration, premiumMigration, tenantMigration, route] = await Promise.all([
  readFile(planMigrationPath, "utf8"),
  readFile(premiumMigrationPath, "utf8"),
  readFile(tenantMigrationPath, "utf8"),
  readFile(routePath, "utf8"),
]);

function policyBlock(source, name) {
  const marker = `CREATE POLICY "${name}"`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing policy ${name}`);
  return source.slice(start, source.indexOf(";", start) + 1);
}

test("staff writes remain tenant-scoped by the existing RLS policy", () => {
  const membersPolicy = policyBlock(premiumMigration, "Members manage staff");
  assert.match(
    membersPolicy,
    /FOR ALL TO authenticated[\s\S]*?can_use_studio\(auth\.uid\(\), studio_id\)[\s\S]*?WITH CHECK/,
  );
  assert.doesNotMatch(membersPolicy, /TO anon/);
});

test("plan visibility policy is unchanged and still restrictive", () => {
  assert.match(
    planMigration,
    /CREATE POLICY "Plan permits visible professionals" ON public\.staff AS RESTRICTIVE[\s\S]*?FOR ALL TO authenticated/,
  );
  assert.match(planMigration, /studio_staff_is_within_plan\(studio_id, id\)/);
  assert.match(planMigration, /studio_can_add_professional\(studio_id\)/);
});

test("plan limits remain enforced by the existing trigger", () => {
  assert.match(
    planMigration,
    /CREATE TRIGGER trg_enforce_plan_professional_limit[\s\S]*?BEFORE INSERT OR UPDATE OF studio_id, is_active ON public\.staff/,
  );
  assert.match(planMigration, /plan_professional_limit_reached/);
});

test("staff-service associations remain tenant-safe", () => {
  assert.match(
    premiumMigration,
    /Members manage staff_services[\s\S]*?s\.id = staff_id[\s\S]*?can_use_studio\(auth\.uid\(\), s\.studio_id\)/,
  );
  assert.match(tenantMigration, /trg_staff_services_same_studio/);
  assert.match(tenantMigration, /s\.id = NEW\.service_id AND s\.studio_id = st\.studio_id/);
});

test("the route fixes INSERT RETURNING without changing RLS", () => {
  assert.match(route, /const id = staff\?\.id \?\? crypto\.randomUUID\(\)/);
  assert.match(route, /\.from\("staff"\)\.insert\(\{ id, \.\.\.payload \}\)/);
  const writeBlock = route.slice(
    route.indexOf("const id = staff?.id ?? crypto.randomUUID()"),
    route.indexOf("await supabase.from(\"staff_services\").delete()"),
  );
  assert.doesNotMatch(writeBlock, /\.select\("id"\)/);
});
