import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolveEffectivePlanTier } from "../src/lib/plan-entitlements";
import { getStudioSubscriptionAccess } from "../src/lib/subscription-access";
import { trialEndUnix } from "../src/lib/subscription-helpers";
import { getTrialNotice } from "../src/lib/trial-notice";

const now = new Date("2026-09-18T12:00:00.000Z");

function afterDays(days: number, hours = 0) {
  return new Date(now.getTime() + (days * 24 + hours) * 60 * 60 * 1000).toISOString();
}

test.describe("trial notice progression", () => {
  test("shows the normal, 7-day, 3-day and last-day messages", () => {
    expect(getTrialNotice(afterDays(14), now)).toMatchObject({
      daysRemaining: 14,
      level: "standard",
    });
    expect(getTrialNotice(afterDays(7), now)).toMatchObject({
      daysRemaining: 7,
      level: "notice",
    });
    expect(getTrialNotice(afterDays(3), now)).toMatchObject({
      daysRemaining: 3,
      level: "warning",
    });
    expect(getTrialNotice(afterDays(1), now)).toMatchObject({
      daysRemaining: 1,
      level: "critical",
      title: "Último dia do teste gratuito",
    });
  });

  test("uses instants instead of browser calendar dates across timezones", () => {
    expect(getTrialNotice("2026-09-19T13:00:00+01:00", now)?.daysRemaining).toBe(1);
    expect(getTrialNotice("2026-09-18T08:00:00-04:00", now)).toBeNull();
  });

  test("does not produce an active notice at or after expiration", () => {
    expect(getTrialNotice(now.toISOString(), now)).toBeNull();
    expect(getTrialNotice("2026-09-17T12:00:00.000Z", now)).toBeNull();
  });
});

test.describe("Trial to Free to upgrade", () => {
  test("a product trial grants Premium and expires to Free without locking the studio", () => {
    const active = getStudioSubscriptionAccess({
      subscription_status: "trialing",
      trial_ends_at: afterDays(14),
      is_active: true,
    }, now);
    const expired = getStudioSubscriptionAccess({
      subscription_status: "trialing",
      trial_ends_at: "2026-09-18T11:59:59.999Z",
      is_active: true,
    }, now);

    expect(active).toMatchObject({ effectivePlan: "premium", trialActive: true, locked: false });
    expect(expired).toMatchObject({
      effectivePlan: "free",
      trialActive: false,
      subscriptionActive: false,
      status: "expired_trial",
      locked: false,
    });
  });

  test("a paid Pro period takes precedence over an overlapping product trial", () => {
    const snapshot = {
      plan_tier: "pro",
      subscription_status: "active",
      subscription_current_period_end: afterDays(30),
      trial_ends_at: afterDays(14),
      is_active: true,
    };
    expect(resolveEffectivePlanTier(snapshot, now)).toBe("pro");
    expect(getStudioSubscriptionAccess(snapshot, now)).toMatchObject({
      effectivePlan: "pro",
      subscriptionActive: true,
      trialActive: false,
      status: "active",
    });
  });

  test("upgrade during a reset trial can carry the authoritative end to Stripe", () => {
    expect(trialEndUnix(afterDays(14), "trialing", null, now)).toBe(
      Math.floor(new Date(afterDays(14)).getTime() / 1000),
    );
    expect(trialEndUnix(afterDays(14), "trialing", now.toISOString(), now)).toBeNull();
    expect(trialEndUnix("2026-09-18T11:59:59.999Z", "trialing", null, now)).toBeNull();
  });
});

test.describe("server-side and webhook safeguards", () => {
  test("database entitlements resolve paid access before the product trial", async () => {
    const migration = await readFile(
      "supabase/migrations/20260918170000_paid_subscription_precedes_product_trial.sql",
      "utf8",
    );
    expect(migration.indexOf("FROM public.subscriptions sub")).toBeLessThan(
      migration.indexOf("product trial grants"),
    );
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
  });

  test("the billing-field trigger distinguishes trusted admin sessions from browsers", async () => {
    const migration = await readFile(
      "supabase/migrations/20260918171000_fix_admin_billing_guard_null_role.sql",
      "utf8",
    );
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'authenticated'");
    expect(migration).toContain("billing_fields_are_server_managed");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
  });

  test("the webhook is idempotent and verifies tenant ownership", async () => {
    const webhook = await readFile("src/routes/api/public/payments/webhook.ts", "utf8");
    expect(webhook).toContain('.rpc("claim_stripe_webhook_event"');
    expect(webhook).toContain('state === "processed"');
    expect(webhook).toContain('state === "busy"');
    expect(webhook).toContain("completeBillingEventClaim(event.id, claim.token)");
    expect(webhook).toContain("failBillingEventClaim(event.id, claim.token, error)");
    expect(webhook).toContain('.from("user_roles")');
    expect(webhook).toContain('.eq("studio_id", studioId)');
    expect(webhook).toContain('.in("role", ["studio_owner", "saas_owner"])');
    expect(webhook).toContain('throw new Error("subscription_customer_binding_invalid")');
    expect(webhook).not.toContain("Invalid subscription data - silently ignore");
    expect(webhook.indexOf("const itemPeriodEnd")).toBeLessThan(
      webhook.indexOf("const trialEnd"),
    );
  });

  test("verified Stripe reactivation can clear the legacy cancellation flag", async () => {
    const migration = await readFile(
      "supabase/migrations/20260923213000_allow_verified_subscription_reactivation.sql",
      "utf8",
    );
    const subscriptions = await readFile("src/lib/subscriptions.functions.ts", "utf8");
    const webhook = await readFile("src/routes/api/public/payments/webhook.ts", "utf8");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER");
    expect(migration).toContain("DROP TRIGGER IF EXISTS preserve_cancel_flag");
    expect(migration).toContain("DROP TRIGGER IF EXISTS preserve_studio_cancel_flag");
    expect(migration).not.toMatch(/DELETE FROM|TRUNCATE TABLE|DROP TABLE/i);
    expect(subscriptions.indexOf("const itemPeriodEnd")).toBeLessThan(
      subscriptions.indexOf("const trialEnd"),
    );
    expect(subscriptions).toContain("subscription = await stripe.subscriptions.retrieve");
    expect(subscriptions).toContain("cancel_at_period_end: false");
    expect(subscriptions).toContain('plan_tier: activeAccess ? planConfig.tier : "free"');
    expect(webhook).toContain('plan_tier: activeAccess ? planConfig.tier : "free"');
    expect(subscriptions).toContain("const productTrialEndsAt = studio.trial_used_at ? null : studio.trial_ends_at");
  });

  test("the dashboard never hides a real trial because of an abandoned checkout", async () => {
    const dashboard = await readFile("src/routes/_authenticated/admin.index.tsx", "utf8");
    const subscriptions = await readFile("src/lib/subscriptions.functions.ts", "utf8");
    expect(dashboard).toContain("billing?.trialActive");
    expect(dashboard).not.toContain("if (hasStripeSubscription) return null");
    expect(dashboard.match(/<TrialPremiumBanner/g)).toHaveLength(1);
    expect(subscriptions).toContain("hasStripeSubscription: Boolean(");
    expect(subscriptions).toContain(": access.status;");
    const adminShell = await readFile("src/routes/_authenticated/admin.tsx", "utf8");
    expect(adminShell).toContain('"/admin/premium",');
  });
});
