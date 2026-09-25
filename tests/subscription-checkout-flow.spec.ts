import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  isInstalledPwa,
  isPaidPlanWorking,
  normalizeStripeBillingUrl,
  prepareStripeBillingNavigation,
} from "../src/lib/subscription-checkout";
import { trialEndUnix } from "../src/lib/subscription-helpers";
import { resolveStripeAppBaseUrl } from "../src/lib/stripe.server";

const root = process.cwd();

test("Free never inherits the idle null state as processing", () => {
  expect(isPaidPlanWorking(null, null)).toBe(false);
  expect(isPaidPlanWorking("pro_monthly", "pro_monthly")).toBe(true);
  expect(isPaidPlanWorking("premium_yearly", "pro_monthly")).toBe(false);
});

test("only hosted Stripe checkout and portal URLs can receive billing navigation", () => {
  expect(normalizeStripeBillingUrl("https://checkout.stripe.com/c/pay/cs_live_safe"))
    .toBe("https://checkout.stripe.com/c/pay/cs_live_safe");
  expect(normalizeStripeBillingUrl("https://billing.stripe.com/p/session/live_safe"))
    .toBe("https://billing.stripe.com/p/session/live_safe");
  expect(() => normalizeStripeBillingUrl("https://stripe.example.com/phishing"))
    .toThrow("invalid_stripe_redirect");
  expect(() => normalizeStripeBillingUrl("http://checkout.stripe.com/insecure"))
    .toThrow("invalid_stripe_redirect");
});

test("installed PWA reserves a browser context during the original click", () => {
  const calls: string[] = [];
  const externalWindow = {
    closed: false,
    location: { replace: (url: string) => calls.push(`external:${url}`) },
    focus: () => calls.push("focus"),
    close: () => calls.push("close"),
  };
  const target = {
    navigator: { standalone: true },
    matchMedia: () => ({ matches: true }),
    open: (url: string) => {
      calls.push(`open:${url}`);
      return externalWindow;
    },
    location: { assign: (url: string) => calls.push(`same-tab:${url}`) },
  };

  expect(isInstalledPwa(target as never)).toBe(true);
  const navigation = prepareStripeBillingNavigation(target as never);
  navigation.complete("https://checkout.stripe.com/c/pay/cs_live_safe");

  expect(calls).toEqual([
    "open:about:blank",
    "external:https://checkout.stripe.com/c/pay/cs_live_safe",
    "focus",
  ]);
});

test("normal browser checkout remains a reliable same-tab redirect", () => {
  const calls: string[] = [];
  const target = {
    navigator: { standalone: false },
    matchMedia: () => ({ matches: false }),
    open: () => {
      calls.push("unexpected-popup");
      return null;
    },
    location: { assign: (url: string) => calls.push(url) },
  };

  const navigation = prepareStripeBillingNavigation(target as never);
  navigation.complete("https://checkout.stripe.com/c/pay/cs_live_browser");
  expect(calls).toEqual(["https://checkout.stripe.com/c/pay/cs_live_browser"]);
});

test("Stripe trial end is omitted inside its mandatory 48-hour boundary", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");
  expect(trialEndUnix("2026-09-11T11:59:59.000Z", "trialing", null, now)).toBeNull();
  expect(trialEndUnix("2026-09-11T12:00:00.000Z", "trialing", null, now))
    .toBe(Math.floor(new Date("2026-09-11T12:00:00.000Z").getTime() / 1000));
  expect(trialEndUnix("2026-09-20T12:00:00.000Z", "active", null, now)).toBeNull();
  expect(trialEndUnix("2026-09-20T12:00:00.000Z", "trialing", now.toISOString(), now)).toBeNull();
});

test("Stripe returns to the exact allow-listed PWA origin", () => {
  const previousStripeEnv = process.env.STRIPE_ENV;
  const previousAppUrl = process.env.APP_URL;
  process.env.STRIPE_ENV = "live";
  process.env.APP_URL = "https://bellza.pt";
  try {
    expect(resolveStripeAppBaseUrl({ request: new Request("https://www.bellza.pt/api/checkout") }))
      .toBe("https://www.bellza.pt");
    expect(resolveStripeAppBaseUrl({ request: new Request("https://bellza.pt/api/checkout") }))
      .toBe("https://bellza.pt");
    expect(resolveStripeAppBaseUrl({ request: new Request("https://evil.example/api/checkout") }))
      .toBe("https://bellza.pt");
  } finally {
    if (previousStripeEnv === undefined) delete process.env.STRIPE_ENV;
    else process.env.STRIPE_ENV = previousStripeEnv;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test("checkout API rejects requests without an authenticated Bellza owner", async ({ request }) => {
  const response = await request.post("/api/create-checkout-session", {
    data: {
      studioId: "99f2ab87-589e-4019-a855-0aafc8b9056c",
      plan: "pro_monthly",
      checkoutAttemptId: "5a8684ee-d459-41ef-a7e8-4f04d95c7f1b",
    },
  });
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: "unauthorized" });
});

test("all paid CTAs use the shared checkout contract and Free uses backend cancellation", () => {
  const plansPage = fs.readFileSync(
    path.join(root, "src/routes/_authenticated/admin.premium.tsx"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src/routes/_authenticated/admin.index.tsx"),
    "utf8",
  );
  const landing = fs.readFileSync(path.join(root, "src/routes/index.tsx"), "utf8");
  const endpoint = fs.readFileSync(
    path.join(root, "src/routes/api/create-checkout-session.ts"),
    "utf8",
  );

  for (const source of [plansPage, dashboard, landing]) {
    expect(source).toContain("requestPlatformCheckout");
    expect(source).toContain("prepareStripeBillingNavigation");
  }
  const landingCheckout = landing.slice(
    landing.indexOf("async function startPlanCheckout"),
    landing.indexOf("const faqSchema"),
  );
  expect(landingCheckout.indexOf("const navigation = prepareStripeBillingNavigation()"))
    .toBeLessThan(landingCheckout.indexOf("await Promise.all"));
  expect(landingCheckout).toContain("finally {");
  expect(landingCheckout).toContain("setCheckoutPlan(null)");
  expect(plansPage).toContain("schedulePlatformSubscriptionCancellation");
  expect(plansPage).toContain("reactivatePlatformSubscription");
  expect(plansPage).toContain("Reativar assinatura");
  expect(plansPage).toContain("syncPlatformCheckoutReturn");
  expect(plansPage).toContain("!summary?.trialActive");
  expect(plansPage).toContain("isPaidPlanWorking(workingPlan, planId)");
  expect(plansPage).not.toContain("workingPlan === planId\n                  ? \"A processar...\"");

  for (const plan of ["pro_monthly", "pro_yearly", "premium_monthly", "premium_yearly"]) {
    expect(dashboard).toContain(`id: "${plan}"`);
    expect(endpoint).toContain(plan);
  }
  expect(dashboard).toContain("PLAN_DEFINITIONS.pro.monthlyCents");
  expect(dashboard).toContain("PLAN_DEFINITIONS.premium.yearlyCents");
});

test("checkout creation is tenant-scoped, retryable and has safe return URLs", () => {
  const endpoint = fs.readFileSync(
    path.join(root, "src/routes/api/create-checkout-session.ts"),
    "utf8",
  );
  const serverFunctions = fs.readFileSync(
    path.join(root, "src/lib/subscriptions.functions.ts"),
    "utf8",
  );
  const helpers = fs.readFileSync(path.join(root, "src/lib/subscription-helpers.ts"), "utf8");

  expect(endpoint).toContain("assertStudioOwnerAccess(sb, user.id, studio.id");
  expect(endpoint).toContain("validateStripeRecurringPrice");
  expect(endpoint).toContain("findReusableCheckoutSession");
  expect(endpoint).toContain("checkout_attempt_id: checkoutAttemptId");
  expect(endpoint).toContain("/admin/premium?billing=success&session_id={CHECKOUT_SESSION_ID}");
  expect(endpoint).toContain("/admin/premium?billing=cancelled");
  expect(serverFunctions).toContain("checkoutAttemptId");
  expect(serverFunctions).toContain('throw new Error("stripe_checkout_required")');
  expect(helpers).toContain('"past_due", "unpaid", "paused"');
  expect(helpers).toContain(".limit(1)");
});

test("reactivation is Stripe-authoritative and terminal subscriptions require a new Checkout", () => {
  const serverFunctions = fs.readFileSync(
    path.join(root, "src/lib/subscriptions.functions.ts"),
    "utf8",
  );
  expect(serverFunctions).toContain("export const reactivatePlatformSubscription");
  expect(serverFunctions).toContain('key: `billing-reactivate:${userId}:${data.studioId}`');
  expect(serverFunctions).toContain('schedule.end_behavior === "cancel"');
  expect(serverFunctions).toContain("preserve_cancel_date: false");
  expect(serverFunctions).toContain("cancel_at_period_end: false");
  expect(serverFunctions).toContain("subscription = await stripe.subscriptions.retrieve(subscription.id");
  expect(serverFunctions).toContain("await syncCheckoutSubscription(sb, subscription, env");
  expect(serverFunctions).toContain("requiresCheckout: true");
  expect(serverFunctions).toContain('throw new Error("stripe_subscription_studio_mismatch")');
  expect(serverFunctions).toContain('throw new Error("stripe_subscription_customer_mismatch")');
});
