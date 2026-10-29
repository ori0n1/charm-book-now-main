import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveEffectivePlanTier } from "../src/lib/plan-entitlements.ts";

const now = new Date("2026-10-29T12:00:00Z");

test("active referral grant temporarily upgrades Pro to Premium", () => {
  assert.equal(resolveEffectivePlanTier({
    plan_tier: "pro",
    subscription_plan_tier: "pro",
    subscription_status: "active",
    subscription_current_period_end: "2026-11-29T12:00:00Z",
    referral_premium_until: "2026-11-12T12:00:00Z",
    is_active: true,
  }, now), "premium");
});

test("expired grant returns to the paid plan", () => {
  assert.equal(resolveEffectivePlanTier({
    plan_tier: "pro",
    subscription_plan_tier: "pro",
    subscription_status: "active",
    subscription_current_period_end: "2026-11-29T12:00:00Z",
    referral_premium_until: "2026-10-29T11:59:59Z",
    is_active: true,
  }, now), "pro");
});

test("inactive studio never gains referral access", () => {
  assert.equal(resolveEffectivePlanTier({
    plan_tier: "free",
    referral_premium_until: "2026-11-12T12:00:00Z",
    is_active: false,
  }, now), "free");
});
