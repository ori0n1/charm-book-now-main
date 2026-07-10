import type Stripe from "stripe";
import type { StripeEnv } from "@/lib/stripe.server";

export const SUBSCRIPTION_PLAN_IDS = ["monthly", "yearly"] as const;
export type SubscriptionPlanId = (typeof SUBSCRIPTION_PLAN_IDS)[number];

// Kept for backward compat with historical data only (no new quarterly subscriptions)
export type LegacySubscriptionPlanId = SubscriptionPlanId | "quarterly";

export type SubscriptionPlanConfig = {
  id: SubscriptionPlanId;
  label: string;
  priceId: string;
};

function envValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return null;
}

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return typeof value === "string" && SUBSCRIPTION_PLAN_IDS.includes(value as SubscriptionPlanId);
}

export function getSubscriptionPlans(env: StripeEnv): Record<SubscriptionPlanId, SubscriptionPlanConfig> {
  const prefix = env === "live" ? "STRIPE_LIVE" : "STRIPE_SANDBOX";
  const monthly = envValue(`${prefix}_PRICE_MONTHLY`, "STRIPE_PRICE_MONTHLY");
  const yearly = envValue(`${prefix}_PRICE_YEARLY`, "STRIPE_PRICE_YEARLY");

  if (!monthly || !yearly) {
    throw new Error("stripe_subscription_prices_not_configured");
  }

  return {
    monthly: { id: "monthly", label: "Premium Mensal", priceId: monthly },
    yearly: { id: "yearly", label: "Premium Anual", priceId: yearly },
  };
}

export function getPlanByPriceId(env: StripeEnv, priceId: string | null | undefined) {
  if (!priceId) return null;
  const plans = getSubscriptionPlans(env);
  return Object.values(plans).find((plan) => plan.priceId === priceId) ?? null;
}

export function getSubscriptionPriceId(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.price.id ?? null;
}

export function inferPlanIdFromSubscription(subscription: Stripe.Subscription): LegacySubscriptionPlanId | null {
  const recurring = subscription.items.data[0]?.price.recurring;
  if (!recurring) return null;

  const intervalCount = recurring.interval_count ?? 1;
  if (recurring.interval === "year" && intervalCount === 1) return "yearly";
  if (recurring.interval === "month" && intervalCount === 3) return "quarterly"; // legacy only
  if (recurring.interval === "month" && intervalCount === 1) return "monthly";
  return null;
}

export function getPlanIdFromSubscription(env: StripeEnv, subscription: Stripe.Subscription) {
  const mappedPlan = getPlanByPriceId(env, getSubscriptionPriceId(subscription));
  return mappedPlan?.id ?? inferPlanIdFromSubscription(subscription);
}
