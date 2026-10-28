import type Stripe from "stripe";
import type { StripeEnv } from "@/lib/stripe.server";
import type { PlanTier } from "@/lib/plan-entitlements";

export const SUBSCRIPTION_PLAN_IDS = [
  "pro_monthly",
  "pro_yearly",
  "premium_monthly",
  "premium_yearly",
] as const;

export type SubscriptionPlanId = (typeof SUBSCRIPTION_PLAN_IDS)[number];
export type SubscriptionBillingInterval = "monthly" | "yearly";

export type SubscriptionPlanConfig = {
  id: SubscriptionPlanId;
  tier: Exclude<PlanTier, "free">;
  billingInterval: SubscriptionBillingInterval;
  label: string;
  priceId: string;
  amountCents: number;
  legacy?: boolean;
};

const PLAN_SPECS: Record<SubscriptionPlanId, Omit<SubscriptionPlanConfig, "priceId">> = {
  pro_monthly: {
    id: "pro_monthly",
    tier: "pro",
    billingInterval: "monthly",
    label: "Pro Mensal",
    amountCents: 1_299,
  },
  pro_yearly: {
    id: "pro_yearly",
    tier: "pro",
    billingInterval: "yearly",
    label: "Pro Anual",
    amountCents: 12_900,
  },
  premium_monthly: {
    id: "premium_monthly",
    tier: "premium",
    billingInterval: "monthly",
    label: "Premium Mensal",
    amountCents: 2_499,
  },
  premium_yearly: {
    id: "premium_yearly",
    tier: "premium",
    billingInterval: "yearly",
    label: "Premium Anual",
    amountCents: 24_900,
  },
};

function envValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return null;
}

function priceEnvKey(env: StripeEnv, planId: SubscriptionPlanId) {
  return `STRIPE_${env === "live" ? "LIVE" : "SANDBOX"}_PRICE_${planId.toUpperCase()}`;
}

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return typeof value === "string" && SUBSCRIPTION_PLAN_IDS.includes(value as SubscriptionPlanId);
}

export function getSubscriptionPlan(env: StripeEnv, planId: SubscriptionPlanId) {
  const priceId = envValue(priceEnvKey(env, planId));
  if (!priceId) throw new Error(`stripe_subscription_price_not_configured:${planId}`);
  return { ...PLAN_SPECS[planId], priceId };
}

export function getSubscriptionPlans(env: StripeEnv): Record<SubscriptionPlanId, SubscriptionPlanConfig> {
  return Object.fromEntries(
    SUBSCRIPTION_PLAN_IDS.map((planId) => [planId, getSubscriptionPlan(env, planId)]),
  ) as Record<SubscriptionPlanId, SubscriptionPlanConfig>;
}

export async function validateStripeRecurringPrice(
  stripe: Stripe,
  env: StripeEnv,
  plan: SubscriptionPlanConfig,
) {
  const price = await stripe.prices.retrieve(plan.priceId);
  if (price.active !== true || !stripeRecurringPriceMatchesPlan(price, env, plan)) {
    throw new Error("stripe_price_environment_mismatch");
  }
  return price;
}

export function stripeRecurringPriceMatchesPlan(
  price: Stripe.Price,
  env: StripeEnv,
  plan: SubscriptionPlanConfig,
) {
  const expectedInterval = plan.billingInterval === "yearly" ? "year" : "month";
  return (
    price.id === plan.priceId &&
    price.livemode === (env === "live") &&
    price.currency === "eur" &&
    (plan.legacy === true || price.unit_amount === plan.amountCents) &&
    price.recurring?.interval === expectedInterval &&
    (price.recurring?.interval_count ?? 1) === 1
  );
}

function getConfiguredPlan(env: StripeEnv, planId: SubscriptionPlanId) {
  const priceId = envValue(priceEnvKey(env, planId));
  return priceId ? ({ ...PLAN_SPECS[planId], priceId } satisfies SubscriptionPlanConfig) : null;
}

function legacyPlanForPrice(env: StripeEnv, priceId: string) {
  const prefix = env === "live" ? "STRIPE_LIVE" : "STRIPE_SANDBOX";
  const monthly = envValue(`${prefix}_PRICE_MONTHLY`, "STRIPE_PRICE_MONTHLY");
  const yearly = envValue(`${prefix}_PRICE_YEARLY`, "STRIPE_PRICE_YEARLY");
  if (priceId === monthly) {
    return { ...PLAN_SPECS.premium_monthly, priceId, legacy: true } satisfies SubscriptionPlanConfig;
  }
  if (priceId === yearly) {
    return { ...PLAN_SPECS.premium_yearly, priceId, legacy: true } satisfies SubscriptionPlanConfig;
  }
  return null;
}

export function getPlanByPriceId(env: StripeEnv, priceId: string | null | undefined) {
  if (!priceId) return null;
  for (const planId of SUBSCRIPTION_PLAN_IDS) {
    const plan = getConfiguredPlan(env, planId);
    if (plan?.priceId === priceId) return plan;
  }
  return legacyPlanForPrice(env, priceId);
}

export function getSubscriptionPriceId(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.price.id ?? null;
}

export function getPlanIdFromSubscription(
  env: StripeEnv,
  subscription: Stripe.Subscription,
): SubscriptionPlanId | null {
  const mappedPlan = getPlanByPriceId(env, getSubscriptionPriceId(subscription));
  return mappedPlan?.id ?? null;
}

export function getPlanConfigFromSubscription(env: StripeEnv, subscription: Stripe.Subscription) {
  return getPlanByPriceId(env, getSubscriptionPriceId(subscription));
}
