import { expect, test } from "@playwright/test";
import { getStudioSubscriptionAccess } from "../src/lib/subscription-access";

const now = new Date("2026-06-27T12:00:00.000Z");
const future = "2026-07-01T12:00:00.000Z";
const past = "2026-06-20T12:00:00.000Z";

test.describe("trial and subscription access", () => {
  test("allows an active 14-day trial", () => {
    const access = getStudioSubscriptionAccess(
      { subscription_status: "trialing", trial_ends_at: future, is_active: true },
      now,
    );

    expect(access.premiumActive).toBe(true);
    expect(access.effectivePlan).toBe("premium");
    expect(access.trialActive).toBe(true);
    expect(access.subscriptionActive).toBe(false);
    expect(access.locked).toBe(false);
    expect(access.status).toBe("trialing");
  });

  test("falls back to Free after the Premium trial without losing studio access", () => {
    const access = getStudioSubscriptionAccess(
      { subscription_status: "trialing", trial_ends_at: past, is_active: true },
      now,
    );

    expect(access.premiumActive).toBe(false);
    expect(access.effectivePlan).toBe("free");
    expect(access.subscriptionActive).toBe(false);
    expect(access.locked).toBe(false);
    expect(access.status).toBe("expired_trial");
    expect(access.redirectTo).toBe("/admin/premium");
    expect(access.message).toContain("teste gratuito terminou");
  });

  test("allows an active Premium subscription even after trial expiration", () => {
    const access = getStudioSubscriptionAccess(
      {
        subscription_status: "active",
        plan_tier: "premium",
        subscription_current_period_end: future,
        trial_ends_at: past,
        is_active: true,
      },
      now,
    );

    expect(access.premiumActive).toBe(true);
    expect(access.effectivePlan).toBe("premium");
    expect(access.locked).toBe(false);
    expect(access.status).toBe("active");
  });

  test("falls back to Free when a cancelled subscription period has ended", () => {
    const access = getStudioSubscriptionAccess(
      {
        subscription_status: "canceled",
        subscription_current_period_end: past,
        trial_ends_at: past,
        is_active: true,
      },
      now,
    );

    expect(access.premiumActive).toBe(false);
    expect(access.effectivePlan).toBe("free");
    expect(access.locked).toBe(false);
    expect(access.status).toBe("expired_trial");
  });

  test("payment failure keeps the studio available on Free", () => {
    const access = getStudioSubscriptionAccess(
      { subscription_status: "past_due", trial_ends_at: past, is_active: true },
      now,
    );

    expect(access.locked).toBe(false);
    expect(access.effectivePlan).toBe("free");
    expect(access.redirectTo).toBe("/admin/premium");
  });

  test("keeps Pro entitlements until a cancelled paid period ends", () => {
    const access = getStudioSubscriptionAccess(
      {
        subscription_status: "canceled",
        subscription_current_period_end: future,
        plan_tier: "pro",
        trial_ends_at: past,
        is_active: true,
      },
      now,
    );

    expect(access.subscriptionActive).toBe(true);
    expect(access.premiumActive).toBe(false);
    expect(access.effectivePlan).toBe("pro");
    expect(access.locked).toBe(false);
  });

  test("new trial snapshots are allowed for the full 14-day window", () => {
    const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const access = getStudioSubscriptionAccess(
      { subscription_status: "trialing", trial_ends_at: trialEndsAt, is_active: true },
      now,
    );

    expect(access.premiumActive).toBe(true);
    expect(access.locked).toBe(false);
    expect(access.status).toBe("trialing");
  });
});
