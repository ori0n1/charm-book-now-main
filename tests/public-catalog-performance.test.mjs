import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveCatalog = readFileSync("src/hooks/use-live-studio.ts", "utf8");
const publicStudioServer = readFileSync("src/lib/public-studio.functions.ts", "utf8");

test("public catalog starts with the production views that actually exist", () => {
  assert.doesNotMatch(liveCatalog, /public_booking_studios|public_booking_staff/);
  assert.match(liveCatalog, /\.from\("public_studios"\)/);
  assert.match(liveCatalog, /\.from\("public_staff"\)/);
});

test("public studio projections match the current production contract", () => {
  const studioProjection = liveCatalog.match(/const studioSelect\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(studioProjection);
  assert.match(studioProjection, /stripe_connect_charges_enabled/);
  assert.match(studioProjection, /stripe_connect_onboarding_completed/);
  assert.match(studioProjection, /stripe_connect_mb_way_payments_enabled/);
  assert.match(studioProjection, /notifications_enabled/);
  assert.doesNotMatch(
    studioProjection,
    /online_payment_ready|mb_way_payment_ready|public_notifications_available/,
  );

  assert.doesNotMatch(publicStudioServer, /public_booking_studios/);
  assert.match(
    publicStudioServer,
    /\.from\("public_studios"\)[\s\S]*booking_flow_mode/,
  );
});
