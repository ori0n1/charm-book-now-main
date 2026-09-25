import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  PLAN_DEFINITIONS,
  planHasFeature,
  planProfessionalLimit,
  requiredFeatureForAdminPath,
  resolveEffectivePlanTier,
} from "../src/lib/plan-entitlements";

const now = new Date("2026-09-07T12:00:00.000Z");
const future = "2026-10-07T12:00:00.000Z";
const past = "2026-09-01T12:00:00.000Z";

test.describe("Free, Pro and Premium entitlement matrix", () => {
  test("uses exact integer-cent prices and professional limits", () => {
    expect(PLAN_DEFINITIONS.free.monthlyCents).toBe(0);
    expect(PLAN_DEFINITIONS.pro.monthlyCents).toBe(1_299);
    expect(PLAN_DEFINITIONS.pro.yearlyCents).toBe(12_900);
    expect(PLAN_DEFINITIONS.premium.monthlyCents).toBe(2_499);
    expect(PLAN_DEFINITIONS.premium.yearlyCents).toBe(24_900);
    expect(planProfessionalLimit("free")).toBe(1);
    expect(planProfessionalLimit("pro")).toBe(3);
    expect(planProfessionalLimit("premium")).toBeNull();
  });

  test("Free includes booking essentials but cannot use paid features", () => {
    for (const feature of ["agenda", "online_booking", "services", "manual_booking", "clients_basic", "public_page"] as const) {
      expect(planHasFeature("free", feature), feature).toBe(true);
    }
    for (const feature of ["online_payments", "notifications", "finance_basic", "whatsapp", "loyalty", "promotions"] as const) {
      expect(planHasFeature("free", feature), feature).toBe(false);
    }
  });

  test("Pro includes operational management but not Premium automations", () => {
    for (const feature of ["clients_full", "team_management", "online_payments", "notifications", "finance_basic", "attendance", "reviews", "reports_basic"] as const) {
      expect(planHasFeature("pro", feature), feature).toBe(true);
    }
    for (const feature of ["whatsapp", "loyalty", "promotions", "finance_advanced", "team_advanced"] as const) {
      expect(planHasFeature("pro", feature), feature).toBe(false);
    }
  });

  test("Premium includes every declared feature", () => {
    for (const feature of PLAN_DEFINITIONS.premium.features) {
      expect(planHasFeature("premium", feature), feature).toBe(true);
    }
  });

  test("14-day trial is Premium and expires safely to Free", () => {
    expect(resolveEffectivePlanTier({ is_active: true, trial_ends_at: future }, now)).toBe("premium");
    expect(resolveEffectivePlanTier({ is_active: true, trial_ends_at: past }, now)).toBe("free");
  });

  test("active and cancelled paid periods preserve their selected tier until period end", () => {
    expect(resolveEffectivePlanTier({
      is_active: true,
      plan_tier: "pro",
      subscription_status: "active",
      subscription_current_period_end: future,
      trial_ends_at: past,
    }, now)).toBe("pro");
    expect(resolveEffectivePlanTier({
      is_active: true,
      plan_tier: "premium",
      subscription_status: "canceled",
      subscription_current_period_end: future,
      trial_ends_at: past,
    }, now)).toBe("premium");
    expect(resolveEffectivePlanTier({
      is_active: true,
      plan_tier: "premium",
      subscription_status: "canceled",
      subscription_current_period_end: past,
      trial_ends_at: past,
    }, now)).toBe("free");
  });

  test("payment failures do not leave paid entitlements active", () => {
    for (const status of ["past_due", "unpaid", "incomplete", "incomplete_expired"]) {
      expect(resolveEffectivePlanTier({
        is_active: true,
        plan_tier: "premium",
        subscription_status: status,
        subscription_current_period_end: future,
        trial_ends_at: past,
      }, now), status).toBe("free");
    }
  });

  test("direct protected routes map to server-equivalent entitlements", () => {
    expect(requiredFeatureForAdminPath("/admin/balcao")).toBe("attendance");
    expect(requiredFeatureForAdminPath("/admin/equipa")).toBe("team_management");
    expect(requiredFeatureForAdminPath("/admin/pagamentos")).toBe("finance_basic");
    expect(requiredFeatureForAdminPath("/admin/sinal")).toBe("online_payments");
    expect(requiredFeatureForAdminPath("/admin/whatsapp")).toBe("whatsapp");
    expect(requiredFeatureForAdminPath("/admin/fidelidade")).toBe("loyalty");
    expect(requiredFeatureForAdminPath("/admin/recebimento")).toBe("finance_advanced");
    expect(requiredFeatureForAdminPath("/admin/agenda")).toBeNull();
  });
});

test.describe("database and backend enforcement", () => {
  test("migration is additive, audited and protects billing columns", async () => {
    const migration = await readFile("supabase/migrations/20260907200000_free_pro_premium_entitlements.sql", "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS plan_tier");
    expect(migration).toContain("studio_effective_plan_tier");
    expect(migration).toContain("studio_has_entitlement");
    expect(migration).toContain("billing_fields_are_server_managed");
    expect(migration).toContain("trg_enforce_plan_professional_limit");
    expect(migration).toContain("trg_record_studio_plan_event");
    expect(migration).toContain("trg_enforce_studio_notification_plan");
    expect(migration).toContain("Plan permits manual financial entries");
    expect(migration).toContain("studio_can_add_professional");
    expect(migration).toContain("membership.role = 'manager'");
    expect(migration).toContain("studio_staff_is_within_plan(_studio_id, professional.id)");
    expect(migration).toContain("studio_effective_plan_tier(_studio_id) = 'premium'");
    expect(migration).toContain('ON public.push_subscriptions AS RESTRICTIVE');
    expect(migration).toContain("AS RESTRICTIVE");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  test("public booking consumes effective plan values in the database", async () => {
    const migration = await readFile("supabase/migrations/20260907201000_plan_aware_public_booking.sql", "utf8");
    expect(migration).toContain("THEN studio.payment_policy");
    expect(migration).toContain("ELSE 'pay_in_studio'");
    expect(migration).toContain("studio_staff_is_within_plan");
    expect(migration).toContain("studio_has_entitlement(studio.id, 'online_booking')");
    expect(migration).toContain("studio_has_entitlement(v_studio_id, 'promotions')");
    expect(migration).toContain("studio_has_entitlement(v_studio_id, 'loyalty')");
    expect(migration).toContain("AS notifications_enabled");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.resolve_booking_service_pricing");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.quote_public_booking");
    expect(migration).toContain("ON public.studio_has_entitlement(p_studio_id, 'promotions')");
    expect(migration).toContain("requested.position > 1 AND offer.id IS NOT NULL");
  });

  test("server guard checks membership and entitlement independently", async () => {
    const source = await readFile("src/lib/server-security.ts", "utf8");
    expect(source).toContain('.from("user_roles")');
    expect(source).toContain('.eq("studio_id", studioId)');
    expect(source).toContain("assertStudioEntitlement");
    expect(source).toContain('rpc("studio_has_entitlement"');
    expect(source).toContain('rpc("can_use_studio"');
    expect(source).toContain("data !== true");
  });

  test("sensitive server operations declare the appropriate entitlement", async () => {
    const sources = await Promise.all([
      readFile("src/lib/payments.functions.ts", "utf8"),
      readFile("src/lib/whatsapp.functions.ts", "utf8"),
      readFile("src/lib/notification-dispatcher.server.ts", "utf8"),
      readFile("src/lib/access.functions.ts", "utf8"),
      readFile("src/lib/reviews.functions.ts", "utf8"),
      readFile("src/lib/withdrawals.functions.ts", "utf8"),
    ]);
    expect(sources[0]).toContain('"online_payments"');
    expect(sources[1]).toContain('"whatsapp"');
    expect(sources[2]).toContain('"notifications"');
    expect(sources[3]).toContain('"team_management"');
    expect(sources[4]).toContain('"reviews"');
    expect(sources[5]).toContain('"finance_advanced"');
  });

  test("public client jobs fail closed for notifications, reviews and loyalty", async () => {
    const source = await readFile("src/lib/public-client.functions.ts", "utf8");
    expect(source).toContain('studioHasEntitlement(sb, studioId, "notifications")');
    expect(source).toContain('studioHasEntitlement(sb, studioId, "reviews")');
    expect(source).toContain('studioHasEntitlement(sb, studioId, "loyalty")');
    expect(source).toContain("entitledCandidates");
    expect(source).toContain("entitlementByStudio");
  });

  test("Stripe plans use exact prices, separate tier and billing interval", async () => {
    const source = await readFile("src/lib/subscription-plans.server.ts", "utf8");
    expect(source).toContain('id: "pro_monthly"');
    expect(source).toContain('id: "pro_yearly"');
    expect(source).toContain('id: "premium_monthly"');
    expect(source).toContain('id: "premium_yearly"');
    expect(source).toContain("amountCents: 1_299");
    expect(source).toContain("amountCents: 12_900");
    expect(source).toContain("amountCents: 2_499");
    expect(source).toContain("amountCents: 24_900");
    expect(source).toContain("billingInterval");
    expect(source).toContain("return mappedPlan?.id ?? null");
    expect(source).not.toContain("inferBillingInterval");
  });

  test("only studio owners can start or change a paid subscription", async () => {
    const [subscriptionSource, helperSource, plansSource] = await Promise.all([
      readFile("src/lib/subscriptions.functions.ts", "utf8"),
      readFile("src/lib/subscription-helpers.ts", "utf8"),
      readFile("src/lib/subscription-plans.server.ts", "utf8"),
    ]);
    expect(helperSource).toContain('.in("role", ["studio_owner", "saas_owner"])');
    expect(subscriptionSource).toContain("assertStudioOwnerAccess");
    expect(subscriptionSource).toContain("validateStripeRecurringPrice");
    expect(plansSource).toContain("price.unit_amount === plan.amountCents");
    expect(plansSource).toContain('price.currency === "eur"');
    expect(plansSource).toContain("price.livemode === (env === \"live\")");
  });
});

test("landing pricing has the three plans and no horizontal overflow", async ({ page }) => {
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#planos");
    await page.waitForLoadState("networkidle");
    const plans = page.locator("#planos");
    await page.getByRole("button", { name: "Mensal", exact: true }).click();
    await expect(plans).toContainText("Free");
    await expect(plans).toContainText("Pro");
    await expect(plans).toContainText("Premium");
    await expect(plans).toContainText("Mais escolhido");
    await expect(plans).toContainText("Pagamentos e sinal online");
    await expect(plans).toContainText("WhatsApp sujeito à franquia");
    await expect(plans).toContainText("Profissionais ativos");
    await expect(plans).toContainText("Até 3");
    await expect(plans).toContainText("Sem limite");
    await expect(plans).toContainText("12,99 €");
    await expect(plans).toContainText("24,99 €");
    await expect(plans.getByRole("button", { name: "Começar grátis" })).toBeEnabled();

    await page.getByRole("button", { name: "Anual −17%" }).click();
    await expect(plans).toContainText("129 €");
    await expect(plans).toContainText("249 €");

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `landing overflow at ${width}px`).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test("landing structured data publishes Free and both billing periods", async ({ page }) => {
  await page.goto("/");
  const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
  const software = schemas.map((schema) => JSON.parse(schema)).find((schema) => schema["@type"] === "SoftwareApplication");
  expect(software).toBeTruthy();
  expect(software.offers).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "Bellza Free", price: "0" }),
    expect.objectContaining({ name: "Bellza Pro mensal", price: "12.99" }),
    expect.objectContaining({ name: "Bellza Pro anual", price: "129" }),
    expect.objectContaining({ name: "Bellza Premium mensal", price: "24.99" }),
    expect.objectContaining({ name: "Bellza Premium anual", price: "249" }),
  ]));
});
