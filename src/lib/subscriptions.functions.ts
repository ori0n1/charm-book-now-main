import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type Stripe from "stripe";
import { z } from "zod";
import { createStripeClient, getConfiguredStripeEnv, resolveStripeAppBaseUrl, type StripeEnv } from "@/lib/stripe.server";
import {
  getSubscriptionPlans,
  getSubscriptionPlan,
  getPlanByPriceId,
  getPlanIdFromSubscription,
  getPlanConfigFromSubscription,
  getSubscriptionPriceId,
  isSubscriptionPlanId,
  validateStripeRecurringPrice,
  type SubscriptionPlanId,
} from "@/lib/subscription-plans.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioOwnerAccess, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import {
  loadPrimaryStudio,
  loadStudioForBilling,
  ensureCustomer,
  assertNoDuplicateActiveSubscription,
  loadSubscriptionForStudio,
  trialEndUnix,
  getDaysRemaining,
  loadRecentInvoices,
  reserveCheckoutSession,
  releaseCheckoutSession,
  markTrialUsed,
} from "@/lib/subscription-helpers";
import { getStudioSubscriptionAccess, isFutureDate } from "@/lib/subscription-access";

function priceRef(priceId: string) {
  return priceId.length > 8 ? `...${priceId.slice(-8)}` : priceId;
}

function checkoutIdempotencyKey(input: {
  studioId: string;
  userId: string;
  planId: SubscriptionPlanId;
  priceId: string;
  checkoutAttemptId: string;
}) {
  return [
    "platform-subscription",
    input.studioId,
    input.userId,
    input.planId,
    input.priceId,
    input.checkoutAttemptId,
  ].join(":");
}

function logCheckoutError(error: unknown, details: Record<string, unknown>) {
  const stripeError = error as {
    code?: string;
    type?: string;
    param?: string;
    message?: string;
  };
  console.error("stripe_checkout_failed", {
    ...details,
    code: stripeError.code ?? "unknown",
    type: stripeError.type ?? "unknown",
    param: stripeError.param ?? null,
    message: stripeError.message ?? String(error),
  });
}

function stripeEnv(): StripeEnv {
  return getConfiguredStripeEnv();
}

function appBaseUrl() {
  return resolveStripeAppBaseUrl({ request: getRequest() });
}

function defaultPlanId(): SubscriptionPlanId {
  const value = process.env.DEFAULT_SUBSCRIPTION_PLAN ?? "premium_monthly";
  return isSubscriptionPlanId(value) ? value : "premium_monthly";
}

const StudioInput = z.object({
  studioId: z.string().uuid(),
  plan: z.enum(["pro_monthly", "pro_yearly", "premium_monthly", "premium_yearly"]).optional(),
  action: z.enum(["manage", "cancel"]).optional(),
  checkoutAttemptId: z.string().uuid().optional(),
});

const PlanChangeInput = z.object({
  studioId: z.string().uuid(),
  plan: z.enum(["pro_monthly", "pro_yearly", "premium_monthly", "premium_yearly"]),
});

const CheckoutReturnInput = z.object({
  studioId: z.string().uuid(),
  sessionId: z.string().min(8),
});

function getCurrentPeriodEnd(subscription: Stripe.Subscription) {
  const extended = subscription as Stripe.Subscription & {
    current_period_end?: number | null;
    trial_end?: number | null;
    items?: { data?: Array<{ current_period_end?: number | null }> };
  };
  const direct = extended.current_period_end;
  if (typeof direct === "number") return direct;
  const itemPeriodEnd = extended.items?.data?.[0]?.current_period_end;
  if (typeof itemPeriodEnd === "number") return itemPeriodEnd;
  const trialEnd = extended.trial_end;
  return typeof trialEnd === "number" ? trialEnd : null;
}

function hasPeriodAccess(status: string, currentPeriodEnd: string | null) {
  if (status === "active") {
    return !currentPeriodEnd || new Date(currentPeriodEnd).getTime() > Date.now();
  }
  if (status === "trialing") {
    return Boolean(currentPeriodEnd && new Date(currentPeriodEnd).getTime() > Date.now());
  }
  return false;
}

function futureDateOrNull(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).getTime() > Date.now() ? value : null;
}

function getSubscriptionScheduleId(subscription: Stripe.Subscription) {
  const schedule = (subscription as Stripe.Subscription & {
    schedule?: string | { id?: string } | null;
  }).schedule;
  if (!schedule) return null;
  return typeof schedule === "string" ? schedule : schedule.id ?? null;
}

async function getUserEmail(sb: ReturnType<typeof getAdminClient>, userId: string) {
  const { data } = await sb.auth.admin.getUserById(userId);
  return data.user?.email ?? null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function portalConfigSignature(input: {
  env: StripeEnv;
  prices: string[];
  products: Array<{ product: string; prices: string[] }>;
}) {
  const prices = [...new Set(input.prices)].sort().join(",");
  const products = input.products
    .map((item) => `${item.product}:${[...new Set(item.prices)].sort().join("|")}`)
    .sort()
    .join(",");
  return `${input.env}:${prices}:${products}`;
}

async function ensureBillingPortalConfiguration(
  stripe: Stripe,
  env: StripeEnv,
  currentSubscription?: Stripe.Subscription | null,
) {
  const configuredPlans = Object.values(getSubscriptionPlans(env));
  const configuredPriceIds = configuredPlans.map((plan) => plan.priceId);
  const currentPriceId = currentSubscription ? getSubscriptionPriceId(currentSubscription) : null;
  const allPriceIds = [...new Set([...configuredPriceIds, ...(currentPriceId ? [currentPriceId] : [])])];
  const productPrices = await Promise.all(
    allPriceIds.map(async (priceId) => {
      const price = await stripe.prices.retrieve(priceId);
      const product = typeof price.product === "string" ? price.product : price.product.id;
      return { product, prices: [priceId] };
    }),
  );
  const products = Object.values(
    productPrices.reduce<Record<string, { product: string; prices: string[] }>>((acc, item) => {
      acc[item.product] ??= { product: item.product, prices: [] };
      acc[item.product].prices.push(...item.prices);
      return acc;
    }, {}),
  );
  const signature = portalConfigSignature({ env, prices: allPriceIds, products });
  const existing = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 10,
  });
  const managed = existing.data.find(
    (configuration) =>
      configuration.metadata?.managed_by === "bellza" &&
      configuration.metadata?.environment === env &&
      configuration.metadata?.signature === signature,
  );
  if (managed) return managed.id;

  const configuration = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "Gerir assinatura Bellza",
    },
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "name", "address"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products,
      },
    },
    metadata: {
      managed_by: "bellza",
      environment: env,
      signature,
    },
  } as any);

  return configuration.id;
}

function shouldRefreshFromStripe(input: {
  subscription: Awaited<ReturnType<typeof loadSubscriptionForStudio>>;
  studioSubscriptionId: string | null;
}) {
  const { subscription, studioSubscriptionId } = input;
  if (!subscription) return true;
  if (!studioSubscriptionId && !subscription.stripe_subscription_id) return true;
  if (subscription.stripe_subscription_id?.startsWith("checkout_pending:")) return true;
  if (!subscription.current_period_end) return true;
  if (new Date(subscription.current_period_end).getTime() <= Date.now()) return true;
  if (!["active", "trialing"].includes(subscription.status)) return true;
  if (
    studioSubscriptionId &&
    subscription.stripe_subscription_id &&
    studioSubscriptionId !== subscription.stripe_subscription_id
  ) {
    return true;
  }
  return true;
}

function subscriptionScore(subscription: Stripe.Subscription, env: StripeEnv, studioId?: string) {
  const priceId = getSubscriptionPriceId(subscription);
  const planConfig = getPlanConfigFromSubscription(env, subscription);
  const planId = planConfig?.id ?? null;
  if (!planId) return 999;
  const mappedPricePenalty = getPlanByPriceId(env, priceId) ? 0 : 0.25;
  const metadataStudioId = subscription.metadata?.studio_id;
  const metadataPenalty = !metadataStudioId || metadataStudioId === studioId ? 0 : 4;
  const statusRank: Record<string, number> = {
    active: 0,
    trialing: 1,
    past_due: 2,
    unpaid: 3,
    incomplete: 4,
    canceled: 5,
    incomplete_expired: 6,
  };
  const periodEnd = getCurrentPeriodEnd(subscription);
  const futurePeriod = periodEnd && periodEnd * 1000 > Date.now() ? -0.5 : 0;
  return (statusRank[subscription.status] ?? 50) + futurePeriod + mappedPricePenalty + metadataPenalty;
}

async function findStripeSubscriptionForStudio(
  stripe: Stripe,
  input: {
    customerId: string | null;
    studioSubscriptionId: string | null;
    studioId: string;
    env: StripeEnv;
    emails?: Array<string | null | undefined>;
  },
) {
  const isBoundToStudio = (subscription: Stripe.Subscription, allowedCustomerIds: Set<string>) => {
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id ?? null;
    const metadataStudioId = subscription.metadata?.studio_id;
    if (!customerId) return false;
    if (allowedCustomerIds.size > 0 && !allowedCustomerIds.has(customerId)) return false;
    if (allowedCustomerIds.size === 0 && metadataStudioId !== input.studioId) return false;
    if (metadataStudioId && metadataStudioId !== input.studioId) return false;
    // Subscriptions discovered only through an email fallback must carry an
    // explicit studio binding. Legacy metadata-free subscriptions are accepted
    // solely for the customer already reserved by this studio.
    if (!metadataStudioId && customerId !== input.customerId) return false;
    return true;
  };

  if (input.studioSubscriptionId && !input.studioSubscriptionId.startsWith("checkout_pending:")) {
    try {
      const subscription = await stripe.subscriptions.retrieve(
        input.studioSubscriptionId,
        { expand: ["schedule"] },
      );
      const directCustomerIds = new Set(
        input.customerId ? [input.customerId] : [],
      );
      if (
        getPlanIdFromSubscription(input.env, subscription) &&
        isBoundToStudio(subscription, directCustomerIds)
      ) {
        return subscription;
      }
      throw new Error("stripe_subscription_owner_mismatch");
    } catch (error) {
      console.warn("stripe_subscription_direct_lookup_failed", {
        studioId: input.studioId,
        subscriptionId: input.studioSubscriptionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const customerIds = new Set<string>();
  if (input.customerId) customerIds.add(input.customerId);

  for (const email of uniqueStrings(input.emails ?? [])) {
    const customers = await stripe.customers.list({ email, limit: 10 });
    for (const customer of customers.data) {
      if (!customer.deleted) customerIds.add(customer.id);
    }
  }

  const subscriptions: Stripe.Subscription[] = [];
  for (const customerId of customerIds) {
    const customerSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    subscriptions.push(...customerSubscriptions.data);
  }

  return subscriptions
    .filter(
      (subscription) =>
        getPlanIdFromSubscription(input.env, subscription) &&
        isBoundToStudio(subscription, customerIds),
    )
    .sort(
      (a, b) =>
        subscriptionScore(a, input.env, input.studioId) -
          subscriptionScore(b, input.env, input.studioId) ||
        (b.created ?? 0) - (a.created ?? 0),
    )[0];
}

async function loadScheduledPlanChange(
  stripe: Stripe,
  env: StripeEnv,
  subscription: Stripe.Subscription | null | undefined,
) {
  if (!subscription) return null;
  const scheduleId = getSubscriptionScheduleId(subscription);
  if (!scheduleId) return null;

  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  if (!["active", "not_started"].includes(schedule.status)) return null;

  const currentPeriodEnd = getCurrentPeriodEnd(subscription);
  const nextPhase =
    schedule.phases.find(
      (phase) =>
        typeof phase.start_date === "number" &&
        Boolean(currentPeriodEnd) &&
        phase.start_date >= currentPeriodEnd!,
    ) ?? schedule.phases[1];
  if (!nextPhase || typeof nextPhase.start_date !== "number") return null;

  const nextPrice = nextPhase.items?.[0]?.price;
  const nextPriceId = typeof nextPrice === "string" ? nextPrice : nextPrice?.id ?? null;
  const nextPlan = getPlanByPriceId(env, nextPriceId);
  const currentPlanId = getPlanIdFromSubscription(env, subscription);
  if (!nextPlan || nextPlan.id === currentPlanId) return null;

  const price = await stripe.prices.retrieve(nextPlan.priceId);
  return {
    plan: nextPlan.id,
    effectiveAt: new Date(nextPhase.start_date * 1000).toISOString(),
    priceId: nextPlan.priceId,
    amount: price.unit_amount ?? null,
    currency: price.currency,
    immediateCharge: false,
  };
}

async function refreshSubscriptionFromStripe(
  sb: ReturnType<typeof getAdminClient>,
  input: {
    userId: string;
    studioId: string;
    customerId: string | null;
    studioSubscriptionId: string | null;
    emails?: Array<string | null | undefined>;
    subscription: Awaited<ReturnType<typeof loadSubscriptionForStudio>>;
    env: StripeEnv;
    reason: string;
    trialEndsAt?: string | null;
  },
) {
  if (
    !shouldRefreshFromStripe({
      subscription: input.subscription,
      studioSubscriptionId: input.studioSubscriptionId,
    })
  ) {
    return input.subscription;
  }

  const stripe = createStripeClient(input.env);
  const stripeSubscription = await findStripeSubscriptionForStudio(stripe, {
    customerId: input.customerId,
    studioSubscriptionId: input.studioSubscriptionId ?? input.subscription?.stripe_subscription_id ?? null,
    studioId: input.studioId,
    env: input.env,
    emails: input.emails,
  });
  if (!stripeSubscription) {
    console.info("stripe_subscription_reconcile_none", {
      studioId: input.studioId,
      reason: input.reason,
    });
    return input.subscription;
  }
  const stripePeriodEnd = getCurrentPeriodEnd(stripeSubscription);
  const stripeCurrentPeriodEnd = stripePeriodEnd ? new Date(stripePeriodEnd * 1000).toISOString() : null;
  if (
    isFutureDate(input.trialEndsAt) &&
    ["canceled", "incomplete_expired", "unpaid"].includes(String(stripeSubscription.status)) &&
    !hasPeriodAccess(String(stripeSubscription.status), stripeCurrentPeriodEnd)
  ) {
    console.info("stripe_subscription_reconcile_skipped_terminal_subscription_during_trial", {
      studioId: input.studioId,
      subscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
      reason: input.reason,
    });
    return input.subscription;
  }

  console.info("stripe_subscription_reconcile_sync", {
    studioId: input.studioId,
    subscriptionId: stripeSubscription.id,
    status: stripeSubscription.status,
    reason: input.reason,
  });
  await syncCheckoutSubscription(sb, stripeSubscription, input.env, {
    userId: input.userId,
    studioId: input.studioId,
    customerId: input.customerId,
  });
  return loadSubscriptionForStudio(sb, input.studioId, input.userId);
}

async function syncCheckoutSubscription(
  sb: ReturnType<typeof getAdminClient>,
  subscription: Stripe.Subscription,
  env: StripeEnv,
  fallback: { userId: string; studioId: string; customerId: string | null },
) {
  const metadata = subscription.metadata ?? {};
  if (metadata.user_id && metadata.user_id !== fallback.userId) {
    throw new Error("stripe_subscription_user_mismatch");
  }
  if (metadata.studio_id && metadata.studio_id !== fallback.studioId) {
    throw new Error("stripe_subscription_studio_mismatch");
  }
  const userId = fallback.userId;
  const studioId = fallback.studioId;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : fallback.customerId;
  if (fallback.customerId && customerId !== fallback.customerId) {
    throw new Error("stripe_subscription_customer_mismatch");
  }
  const priceId = getSubscriptionPriceId(subscription);
  const planConfig = getPlanConfigFromSubscription(env, subscription);
  const planId = planConfig?.id ?? null;
  const status = subscription.status ?? "incomplete";
  const periodEnd = getCurrentPeriodEnd(subscription);
  const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  if (!userId || !studioId || !customerId || !priceId || !planConfig || !planId) {
    throw new Error("stripe_subscription_sync_incomplete");
  }

  const activeAccess = hasPeriodAccess(status, currentPeriodEnd);
  const subscriptionPatch = {
    user_id: userId,
    studio_id: studioId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    plan: planConfig.billingInterval,
    plan_tier: planConfig.tier,
    status,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };

  const { data: pendingSubscription, error: pendingError } = await sb
    .from("subscriptions")
    .select("id")
    .eq("studio_id", studioId)
    .eq("status", "checkout_pending")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) throw pendingError;

  const { error: subscriptionError } = pendingSubscription?.id
    ? await sb.from("subscriptions").update(subscriptionPatch).eq("id", pendingSubscription.id)
    : await sb.from("subscriptions").upsert(subscriptionPatch, {
        onConflict: "stripe_subscription_id",
      });
  if (subscriptionError) throw subscriptionError;

  if (activeAccess) {
    await markTrialUsed(sb, studioId).catch(() => undefined);
  }

  const { error: studioError } = await sb
    .from("studios")
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      subscription_status: status,
      subscription_current_period_end: currentPeriodEnd,
      subscription_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      premium_access_until: activeAccess ? currentPeriodEnd : null,
      plan_tier: activeAccess ? planConfig.tier : "free",
      plan: activeAccess ? "pro" : "trial",
      updated_at: new Date().toISOString(),
    })
    .eq("id", studioId);
  if (studioError) throw studioError;

  return { status, plan: planConfig.billingInterval, plan_tier: planConfig.tier, currentPeriodEnd };
}

async function repairSubscriptionPeriodIfMissing(
  sb: ReturnType<typeof getAdminClient>,
  input: {
    userId: string;
    studioId: string;
    subscription: NonNullable<Awaited<ReturnType<typeof loadSubscriptionForStudio>>>;
    env: StripeEnv;
  },
) {
  if (
    input.subscription.current_period_end ||
    !input.subscription.stripe_subscription_id ||
    input.subscription.stripe_subscription_id.startsWith("checkout_pending:")
  ) {
    return input.subscription;
  }

  const stripe = createStripeClient(input.env);
  const stripeSubscription = await stripe.subscriptions.retrieve(
    input.subscription.stripe_subscription_id,
  );
  await syncCheckoutSubscription(sb, stripeSubscription, input.env, {
    userId: input.userId,
    studioId: input.studioId,
    customerId: input.subscription.stripe_customer_id,
  });
  return loadSubscriptionForStudio(sb, input.studioId, input.userId);
}

async function recoverPendingCheckout(
  sb: ReturnType<typeof getAdminClient>,
  input: {
    userId: string;
    studioId: string;
    customerId: string | null;
    env: StripeEnv;
    trialEndsAt?: string | null;
  },
) {
  if (!input.customerId) return false;
  const stripe = createStripeClient(input.env);
  const sessions = await stripe.checkout.sessions.list({
    customer: input.customerId,
    limit: 10,
  });
  const session = sessions.data.find(
    (item) =>
      item.mode === "subscription" &&
      item.status === "complete" &&
      item.metadata?.studio_id === input.studioId &&
      item.metadata?.user_id === input.userId &&
      typeof item.subscription === "string",
  );
  if (!session || typeof session.subscription !== "string") return false;

  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  const periodEnd = getCurrentPeriodEnd(subscription);
  const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
  if (
    isFutureDate(input.trialEndsAt) &&
    ["canceled", "incomplete_expired", "unpaid"].includes(String(subscription.status)) &&
    !hasPeriodAccess(String(subscription.status), currentPeriodEnd)
  ) {
    await releaseCheckoutSession(sb, { userId: input.userId, studioId: input.studioId });
    console.info("stripe_checkout_recovery_skipped_terminal_subscription_during_trial", {
      studioId: input.studioId,
      subscriptionId: subscription.id,
      status: subscription.status,
    });
    return false;
  }
  await syncCheckoutSubscription(sb, subscription, input.env, {
    userId: input.userId,
    studioId: input.studioId,
    customerId: typeof session.customer === "string" ? session.customer : input.customerId,
  });
  return true;
}

async function findReusableOpenCheckout(
  stripe: Stripe,
  input: {
    customerId: string;
    studioId: string;
    userId: string;
    plan: SubscriptionPlanId;
    priceId: string;
  },
) {
  const sessions = await stripe.checkout.sessions.list({
    customer: input.customerId,
    limit: 10,
  });
  const now = Math.floor(Date.now() / 1000);
  return (
    sessions.data.find(
      (session) =>
        session.mode === "subscription" &&
        session.status === "open" &&
        Boolean(session.url) &&
        (session.expires_at ?? 0) > now &&
        session.metadata?.studio_id === input.studioId &&
        session.metadata?.user_id === input.userId &&
        session.metadata?.plan === input.plan &&
        (!session.metadata?.price_id || session.metadata.price_id === input.priceId),
    ) ?? null
  );
}

export const getPlatformSubscriptionSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertStudioOwnerAccess(sb, (context as any).userId, data.studioId, {
      allowExpiredTrial: true,
    });
    const { data: studio, error } = await sb
      .from("studios")
      .select(
        "id,email,plan,plan_tier,stripe_customer_id,stripe_subscription_id,subscription_status,subscription_current_period_end,subscription_cancel_at_period_end,premium_access_until,trial_ends_at,trial_used_at",
      )
      .eq("id", data.studioId)
      .maybeSingle();

    if (error) {
      return {
        available: false,
        plan: "trial",
        status: "trialing",
        nextBillingAt: null,
        trialEndsAt: null,
        daysRemaining: null,
        cancelAtPeriodEnd: false,
        subscriptionActive: false,
        premiumActive: false,
        effectivePlan: "free" as const,
        trialActive: false,
        invoices: [],
      };
    }

    if (!studio) throw new Error("studio_not_found");

    const userId = (context as any).userId as string;
    // A product trial is single-use. Once a verified Stripe subscription has
    // consumed it, terminal cancellation must fall back to Free rather than
    // resurrecting the original trial window.
    const productTrialEndsAt = studio.trial_used_at ? null : studio.trial_ends_at;
    const userEmail = await getUserEmail(sb, userId).catch(() => null);
    let subscription = await loadSubscriptionForStudio(sb, studio.id as string, userId);
    if (subscription?.status === "checkout_pending") {
      const recovered = await recoverPendingCheckout(sb, {
        userId,
        studioId: studio.id as string,
        customerId: studio.stripe_customer_id as string | null,
        env: stripeEnv(),
        trialEndsAt: productTrialEndsAt as string | null,
      }).catch((error) => {
        console.error("stripe_checkout_recovery_failed", {
          studioId: studio.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      });
      if (recovered) {
        subscription = await loadSubscriptionForStudio(sb, studio.id as string, userId);
      } else if (subscription?.status === "checkout_pending") {
        subscription = await loadSubscriptionForStudio(sb, studio.id as string, userId);
      }
    }
    if (subscription) {
      subscription =
        (await repairSubscriptionPeriodIfMissing(sb, {
          userId,
          studioId: studio.id as string,
          subscription,
          env: stripeEnv(),
        }).catch((error) => {
          console.error("stripe_subscription_period_repair_failed", {
            studioId: studio.id,
            message: error instanceof Error ? error.message : String(error),
          });
          return subscription;
        })) ?? subscription;
    }
    subscription =
      (await refreshSubscriptionFromStripe(sb, {
        userId,
        studioId: studio.id as string,
        customerId:
          (studio.stripe_customer_id as string | null) ??
          subscription?.stripe_customer_id ??
          null,
        studioSubscriptionId: studio.stripe_subscription_id as string | null,
        emails: [userEmail, studio.email as string | null],
        subscription,
        env: stripeEnv(),
        reason: "summary",
        trialEndsAt: productTrialEndsAt as string | null,
      }).catch((error) => {
        console.error("stripe_subscription_reconcile_failed", {
          studioId: studio.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return subscription;
      })) ?? subscription;
    const studioTrialActiveByDate = Boolean(
      productTrialEndsAt &&
        new Date(productTrialEndsAt as string).getTime() > Date.now(),
    );
    if (
      studioTrialActiveByDate &&
      subscription &&
      ["canceled", "incomplete_expired", "unpaid"].includes(String(subscription.status)) &&
      !hasPeriodAccess(String(subscription.status), subscription.current_period_end)
    ) {
      subscription = null;
    }
    const rawStatus = (subscription?.status ?? studio.subscription_status ?? "trialing") as string;
    const premiumUntil =
      subscription?.current_period_end ??
      studio.premium_access_until ??
      studio.subscription_current_period_end;
    const trialEndsAt = productTrialEndsAt ?? null;
    const hasStripePlan = ["monthly", "quarterly", "yearly"].includes(subscription?.plan ?? ""); // quarterly kept for historical data
    const studioTrialActive =
      studio.subscription_status === "trialing" &&
      trialEndsAt &&
      new Date(trialEndsAt as string).getTime() > Date.now();
    const subscriptionTrialActive = rawStatus === "trialing" && hasPeriodAccess(rawStatus, premiumUntil);
    const paidActive =
      hasPeriodAccess(rawStatus, premiumUntil) ||
      hasPeriodAccess(studio.subscription_status as string, premiumUntil);
    const detectedTrialActive = Boolean(studioTrialActive || subscriptionTrialActive);
    const access = getStudioSubscriptionAccess({
      plan_tier: studio.plan_tier as string | null,
      subscription_plan_tier: subscription?.plan_tier ?? null,
      subscription_status: rawStatus,
      subscription_current_period_end:
        subscription?.current_period_end ?? studio.subscription_current_period_end ?? null,
      premium_access_until: studio.premium_access_until ?? null,
      trial_ends_at: trialEndsAt,
      is_active: true,
    });
    const trialActive = access.trialActive && detectedTrialActive;
    const subscriptionActive = access.subscriptionActive;
    const premiumActive = access.premiumActive;
    const status =
      rawStatus === "canceled" && paidActive
        ? "active"
        : paidActive && rawStatus !== "trialing"
          ? rawStatus
          : trialActive
            ? "trialing"
            : access.status;
    const rawNextBillingAt =
      trialActive && !paidActive
        ? studio.trial_ends_at ?? null
        : subscription?.current_period_end ??
          studio.subscription_current_period_end ??
          studio.trial_ends_at ??
          null;
    const nextBillingAt =
      status === "trialing" && !hasStripePlan
        ? rawNextBillingAt
        : futureDateOrNull(rawNextBillingAt);
    const daysRemaining = getDaysRemaining(
      status === "trialing" && !hasStripePlan
        ? trialEndsAt
        : nextBillingAt,
    );
    const env = stripeEnv();
    const stripe = createStripeClient(env);
    const stripeSubscription = await findStripeSubscriptionForStudio(stripe, {
      customerId:
        subscription?.stripe_customer_id ??
        (studio.stripe_customer_id as string | null) ??
        null,
      studioSubscriptionId:
        subscription?.stripe_subscription_id ??
        (studio.stripe_subscription_id as string | null) ??
        null,
      studioId: studio.id as string,
      env,
      emails: [userEmail, studio.email as string | null],
    }).catch((error) => {
      console.error("stripe_subscription_schedule_lookup_failed", {
        studioId: studio.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    const pendingChange = await loadScheduledPlanChange(stripe, env, stripeSubscription).catch(
      (error) => {
        console.error("stripe_subscription_schedule_summary_failed", {
          studioId: studio.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      },
    );

    // Detect schedule-based cancellation.
    // Stripe billing portal sometimes uses subscription schedules instead of cancel_at_period_end flag.
    // Use || so that EITHER the subscription row OR the studio row being true is sufficient.
    let cancelAtPeriodEnd =
      Boolean(subscription?.cancel_at_period_end) ||
      Boolean(studio.subscription_cancel_at_period_end);

    if (!cancelAtPeriodEnd && stripeSubscription) {
      // Log raw Stripe data to diagnose what Stripe actually returns
      const rawScheduleField = (stripeSubscription as any).schedule;
      const rawCancelFlag = stripeSubscription.cancel_at_period_end;
      console.info("stripe_cancellation_debug", {
        studioId: studio.id,
        subscriptionId: stripeSubscription.id,
        stripeCancelAtPeriodEnd: rawCancelFlag,
        stripeScheduleField: rawScheduleField
          ? (typeof rawScheduleField === "string" ? rawScheduleField : JSON.stringify(rawScheduleField))
          : null,
        dbCancelAtPeriodEnd: subscription?.cancel_at_period_end,
      });

      // Step 1: Attached schedule (expanded or ID)
      const scheduleId = getSubscriptionScheduleId(stripeSubscription);
      if (scheduleId) {
        try {
          const schedule = typeof scheduleId === "string"
            ? await stripe.subscriptionSchedules.retrieve(scheduleId)
            : rawScheduleField as Stripe.SubscriptionSchedule;
          console.info("stripe_attached_schedule_data", {
            studioId: studio.id,
            scheduleId: schedule.id,
            status: schedule.status,
            endBehavior: schedule.end_behavior,
            phases: schedule.phases?.length,
          });
          if (schedule && schedule.status === "active" && schedule.end_behavior === "cancel") {
            cancelAtPeriodEnd = true;
          }
        } catch (err) {
          console.warn("stripe_attached_schedule_retrieve_failed", { studioId: studio.id, error: String(err) });
        }
      }

      // Step 2: List all customer schedules
      if (!cancelAtPeriodEnd) {
        const stripeCustomerId =
          subscription?.stripe_customer_id ??
          (studio.stripe_customer_id as string | null) ??
          (typeof stripeSubscription.customer === "string"
            ? stripeSubscription.customer
            : stripeSubscription.customer?.id ?? null);
        if (stripeCustomerId) {
          try {
            const allSchedules = await stripe.subscriptionSchedules.list({
              customer: stripeCustomerId,
              limit: 10,
            });
            console.info("stripe_schedule_list_data", {
              studioId: studio.id,
              count: allSchedules.data.length,
              schedules: allSchedules.data.map((s) => ({
                id: s.id,
                status: s.status,
                endBehavior: s.end_behavior,
                subscription: typeof s.subscription === "string" ? s.subscription : s.subscription?.id,
                phases: s.phases?.length,
              })),
            });
            const cancellingSchedule = allSchedules.data.find((s) => {
              const subId =
                typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
              if (subId !== stripeSubscription.id) return false;
              if (!["active", "not_started"].includes(s.status)) return false;
              const stripeCurrentPeriodEnd = getCurrentPeriodEnd(stripeSubscription);
              // Check end_behavior OR phases ending at/before current period end
              if (s.end_behavior === "cancel") return true;
              // Stripe may use "release" end_behavior but with phases ending at period end
              if (s.phases && s.phases.length > 0) {
                const lastPhase = s.phases[s.phases.length - 1];
                if (lastPhase.end_date && stripeCurrentPeriodEnd) {
                  // If schedule ends on or before the subscription's current period end → cancels
                  if (Number(lastPhase.end_date) <= Number(stripeCurrentPeriodEnd) + 60) {
                    return true;
                  }
                }
              }
              return false;
            });
            if (cancellingSchedule) {
              cancelAtPeriodEnd = true;
              console.info("stripe_schedule_cancellation_confirmed", {
                studioId: studio.id,
                scheduleId: cancellingSchedule.id,
                endBehavior: cancellingSchedule.end_behavior,
              });
              // Persist to DB so future loads skip the Stripe API call
              if (subscription?.stripe_subscription_id) {
                await sb
                  .from("subscriptions")
                  .update({ cancel_at_period_end: true })
                  .eq("stripe_subscription_id", subscription.stripe_subscription_id);
              }
            }
          } catch (err) {
            console.warn("stripe_schedule_list_failed", { studioId: studio.id, error: String(err) });
          }
        }
      }
    }
    const visibleCancelAtPeriodEnd = Boolean(
        cancelAtPeriodEnd &&
        hasStripePlan &&
        subscriptionActive &&
        status !== "trialing" &&
        rawStatus !== "checkout_pending",
    );
    const billingInterval =
      subscription?.plan === "yearly" ? "yearly" : subscription?.plan === "monthly" ? "monthly" : null;
    const paidTier =
      subscription?.plan_tier === "pro" || subscription?.plan_tier === "premium"
        ? subscription.plan_tier
        : studio.plan_tier === "pro"
          ? "pro"
          : "premium";
    const displayPlan = billingInterval ? `${paidTier}_${billingInterval}` : null;
    return {
      available: true,
      plan: displayPlan,
      billingInterval,
      planTier: subscription?.plan_tier ?? studio.plan_tier ?? "free",
      effectivePlan: access.effectivePlan,
      trialActive,
      hasStripeSubscription: Boolean(
        stripeSubscription &&
          !["canceled", "incomplete_expired", "unpaid"].includes(stripeSubscription.status),
      ),
      status,
      nextBillingAt,
      trialEndsAt,
      daysRemaining,
      cancelAtPeriodEnd: visibleCancelAtPeriodEnd,
      pendingChange,
      subscriptionActive,
      premiumActive,
      invoices: await loadRecentInvoices(
        env,
        subscription?.stripe_customer_id ?? (studio.stripe_customer_id as string | null),
      ),
    };
  });

export const createPlatformCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId;
    await assertStudioOwnerAccess(sb, userId, data.studioId, { allowExpiredTrial: true });
    await rateLimitOrThrow({
      key: `billing-checkout:${userId}:${data.studioId}`,
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });
    const studio = await loadStudioForBilling(sb, data.studioId);
    const env = stripeEnv();
    const plan = getSubscriptionPlan(env, data.plan ?? defaultPlanId());
    const stripe = createStripeClient(env);
    const userEmail = await getUserEmail(sb, userId).catch(() => null);
    const customerId = await ensureCustomer(sb, stripe, studio);
    await recoverPendingCheckout(sb, {
      userId,
      studioId: studio.id,
      customerId,
      env,
      trialEndsAt: studio.trial_ends_at,
    }).catch((error) => {
      console.error("stripe_checkout_recovery_before_create_failed", {
        studioId: studio.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    let existingSubscription = await loadSubscriptionForStudio(sb, studio.id, userId);
    existingSubscription =
      (await refreshSubscriptionFromStripe(sb, {
        userId,
        studioId: studio.id,
        customerId,
        studioSubscriptionId: existingSubscription?.stripe_subscription_id ?? null,
        emails: [userEmail, studio.email],
        subscription: existingSubscription,
        env,
        reason: "before_checkout",
        trialEndsAt: studio.trial_ends_at,
      }).catch((error) => {
        console.error("stripe_subscription_reconcile_before_checkout_failed", {
          studioId: studio.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return existingSubscription;
      })) ?? existingSubscription;
    if (
      existingSubscription?.stripe_subscription_id &&
      !existingSubscription.stripe_subscription_id.startsWith("checkout_pending:") &&
      hasPeriodAccess(existingSubscription.status, existingSubscription.current_period_end)
    ) {
      const stripeSubscription = await stripe.subscriptions.retrieve(
        existingSubscription.stripe_subscription_id,
      );
      const portal = await stripe.billingPortal.sessions.create({
        customer: existingSubscription.stripe_customer_id ?? customerId,
        configuration: await ensureBillingPortalConfiguration(stripe, env, stripeSubscription),
        return_url: `${appBaseUrl()}/admin/premium`,
      });
      return { url: portal.url };
    }
    await assertNoDuplicateActiveSubscription(sb, studio.id);
    try {
      await validateStripeRecurringPrice(stripe, env, plan);
    } catch (error) {
      logCheckoutError(error, {
        stage: "price_lookup",
        stripeEnv: env,
        studioId: studio.id,
        plan: plan.id,
        price: priceRef(plan.priceId),
      });
      throw error;
    }
    const reusableCheckout = await findReusableOpenCheckout(stripe, {
      customerId,
      studioId: studio.id,
      userId,
      plan: plan.id,
      priceId: plan.priceId,
    });
    if (reusableCheckout?.url) {
      return { url: reusableCheckout.url, sessionId: reusableCheckout.id, reused: true };
    }
    await reserveCheckoutSession(sb, {
      userId,
      studioId: studio.id,
      planId: plan.id,
      planTier: plan.tier,
      billingInterval: plan.billingInterval,
      priceId: plan.priceId,
      customerId,
    });
    const trialEnd = trialEndUnix(
      studio.trial_ends_at,
      studio.subscription_status,
      studio.trial_used_at,
    );
    const checkoutAttemptId = data.checkoutAttemptId ?? crypto.randomUUID();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: studio.id,
        line_items: [{ price: plan.priceId, quantity: 1 }],
        success_url: `${appBaseUrl()}/admin/premium?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appBaseUrl()}/admin/premium?billing=cancelled`,
        metadata: {
          studio_id: studio.id,
          user_id: userId,
          plan: plan.id,
          plan_tier: plan.tier,
          billing_interval: plan.billingInterval,
          price_id: plan.priceId,
          checkout_attempt_id: checkoutAttemptId,
        },
        subscription_data: {
          metadata: {
            studio_id: studio.id,
            user_id: userId,
            plan: plan.id,
            plan_tier: plan.tier,
            billing_interval: plan.billingInterval,
            price_id: plan.priceId,
          },
          ...(trialEnd ? { trial_end: trialEnd } : {}),
        },
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      }, {
        idempotencyKey: checkoutIdempotencyKey({
          studioId: studio.id,
          userId,
          planId: plan.id,
          priceId: plan.priceId,
          checkoutAttemptId,
        }),
      });
    } catch (error) {
      await releaseCheckoutSession(sb, { userId, studioId: studio.id });
      logCheckoutError(error, {
        stage: "session_create",
        stripeEnv: env,
        studioId: studio.id,
        plan: plan.id,
        price: priceRef(plan.priceId),
      });
      throw error;
    }
    if (!session.url) {
      await releaseCheckoutSession(sb, { userId, studioId: studio.id });
      throw new Error("checkout_url_missing");
    }
    return { url: session.url, sessionId: session.id, reused: false };
  });

export const syncPlatformCheckoutReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CheckoutReturnInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;
    await assertStudioOwnerAccess(sb, userId, data.studioId, { allowExpiredTrial: true });
    await rateLimitOrThrow({
      key: `billing-checkout-sync:${userId}:${data.studioId}`,
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });

    const env = stripeEnv();
    const stripe = createStripeClient(env);
    const session = await stripe.checkout.sessions.retrieve(data.sessionId);

    if (session.mode !== "subscription") throw new Error("checkout_session_not_subscription");
    if (session.metadata?.studio_id !== data.studioId || session.metadata?.user_id !== userId) {
      throw new Error("checkout_session_owner_mismatch");
    }
    if (session.payment_status !== "paid" && session.status !== "complete") {
      throw new Error("checkout_session_not_complete");
    }
    if (typeof session.subscription !== "string") {
      throw new Error("checkout_session_missing_subscription");
    }

    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    return syncCheckoutSubscription(sb, subscription, env, {
      userId,
      studioId: data.studioId,
      customerId: typeof session.customer === "string" ? session.customer : null,
    });
  });

export const createPlatformBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId;
    await assertStudioOwnerAccess(sb, userId, data.studioId, { allowExpiredTrial: true });
    await rateLimitOrThrow({
      key: `billing-portal:${userId}:${data.studioId}`,
      limit: 8,
      windowMs: 10 * 60 * 1000,
    });
    const studio = await loadStudioForBilling(sb, data.studioId);
    const env = stripeEnv();
    const stripe = createStripeClient(env);
    const userEmail = await getUserEmail(sb, userId).catch(() => null);
    const subscription = await loadSubscriptionForStudio(sb, studio.id, userId);
    const refreshedSubscription = await refreshSubscriptionFromStripe(sb, {
      userId,
      studioId: studio.id,
      customerId: studio.stripe_customer_id,
      studioSubscriptionId: null,
      emails: [userEmail, studio.email],
      subscription,
      env,
      reason: "before_portal",
      trialEndsAt: studio.trial_ends_at,
    }).catch((error) => {
      console.error("stripe_subscription_reconcile_before_portal_failed", {
        studioId: studio.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return subscription;
    });
    const stripeSubscription = await findStripeSubscriptionForStudio(stripe, {
      customerId:
        refreshedSubscription?.stripe_customer_id ??
        subscription?.stripe_customer_id ??
        studio.stripe_customer_id ??
        null,
      studioSubscriptionId:
        refreshedSubscription?.stripe_subscription_id ??
        subscription?.stripe_subscription_id ??
        null,
      studioId: studio.id,
      env,
      emails: [userEmail, studio.email],
    }).catch((error) => {
      console.error("stripe_subscription_portal_lookup_failed", {
        studioId: studio.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    const customerId =
      (typeof stripeSubscription?.customer === "string" ? stripeSubscription.customer : null) ??
      refreshedSubscription?.stripe_customer_id ??
      subscription?.stripe_customer_id ??
      studio.stripe_customer_id ??
      (await ensureCustomer(sb, stripe, studio));
    if (stripeSubscription) {
      await syncCheckoutSubscription(sb, stripeSubscription, env, {
        userId,
        studioId: studio.id,
        customerId,
      }).catch((error) => {
        console.error("stripe_subscription_sync_before_portal_failed", {
          studioId: studio.id,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    let configuration: string | undefined;
    try {
      configuration = await ensureBillingPortalConfiguration(stripe, env, stripeSubscription ?? undefined);
    } catch (error) {
      console.error("stripe_billing_portal_configuration_failed", {
        studioId: studio.id,
        message: error instanceof Error ? error.message : String(error),
      });
      // Fall back to Stripe's default portal configuration
    }

    // Detect schedule-based cancellation.
    // Stripe billing portal uses subscription schedules with end_behavior:"cancel" instead of
    // the cancel_at_period_end flag — so we check both the subscription's attached schedule
    // AND list all schedules for the customer as a fallback.
    let scheduledForCancellation = Boolean(stripeSubscription?.cancel_at_period_end);
    if (!scheduledForCancellation && stripeSubscription) {
      // Step 1: expanded schedule on subscription object
      const scheduleId = getSubscriptionScheduleId(stripeSubscription);
      if (scheduleId) {
        try {
          const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
          if (schedule.status === "active" && schedule.end_behavior === "cancel") {
            scheduledForCancellation = true;
            console.info("stripe_portal_schedule_attached_detected", { studioId: studio.id, scheduleId });
          }
        } catch {
          // Ignore
        }
      }
      // Step 2: list all schedules for customer (portal may not link schedule to subscription)
      if (!scheduledForCancellation && customerId) {
        try {
          const schedules = await stripe.subscriptionSchedules.list({ customer: customerId, limit: 10 });
          const found = schedules.data.find((s) => {
            const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
            return subId === stripeSubscription.id && s.status === "active" && s.end_behavior === "cancel";
          });
          if (found) {
            scheduledForCancellation = true;
            console.info("stripe_portal_schedule_list_detected", { studioId: studio.id, scheduleId: found.id });
          }
        } catch {
          // Ignore
        }
      }
    }

    // Only add cancel flow_data if subscription is actively cancellable (not already scheduled)
    const isCancellable =
      stripeSubscription &&
      ["active", "trialing", "past_due"].includes(stripeSubscription.status) &&
      !scheduledForCancellation;

    const portalArgs: Record<string, unknown> = {
      customer: customerId,
      ...(configuration ? { configuration } : {}),
      return_url: `${appBaseUrl()}/admin/premium`,
      ...(data.action === "cancel" && isCancellable
        ? {
            flow_data: {
              type: "subscription_cancel",
              subscription_cancel: { subscription: stripeSubscription!.id },
              after_completion: {
                type: "redirect",
                redirect: { return_url: `${appBaseUrl()}/admin/premium` },
              },
            },
          }
        : {}),
    };

    let session: Stripe.BillingPortal.Session;
    try {
      session = await stripe.billingPortal.sessions.create(portalArgs as any);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Stripe rejects when subscription is already scheduled for cancellation via a schedule.
      // Retry without flow_data and persist the real state to DB so badge updates on next load.
      if (msg.includes("canceled at period end") || msg.includes("cancel_at_period_end")) {
        // Stripe confirms this subscription is already scheduled for cancellation.
        // Persist to BOTH studios and subscriptions tables so the badge is correct on next load.
        const subIdToUpdate =
          stripeSubscription?.id ??
          subscription?.stripe_subscription_id ??
          refreshedSubscription?.stripe_subscription_id;
        console.warn("stripe_portal_retry_without_flow_data", {
          studioId: studio.id,
          subIdToUpdate,
          hasStripeSubscription: Boolean(stripeSubscription),
        });
        // Update studios table (always available, used as fallback in summary)
        const { error: studioErr } = await sb
          .from("studios")
          .update({ subscription_cancel_at_period_end: true })
          .eq("id", studio.id);
        if (studioErr) {
          console.error("stripe_cancel_studio_update_failed", { studioId: studio.id, error: studioErr.message });
        } else {
          console.info("stripe_cancel_studio_update_ok", { studioId: studio.id });
        }
        // Also update subscriptions table
        if (subIdToUpdate) {
          const { error: subErr } = await sb
            .from("subscriptions")
            .update({ cancel_at_period_end: true })
            .eq("stripe_subscription_id", subIdToUpdate);
          if (subErr) {
            console.error("stripe_cancel_sub_update_failed", { studioId: studio.id, error: subErr.message });
          } else {
            console.info("stripe_cancel_sub_update_ok", { studioId: studio.id, subIdToUpdate });
          }
        }
        const { flow_data: _ignored, ...argsWithoutFlow } = portalArgs as any;
        session = await stripe.billingPortal.sessions.create(argsWithoutFlow);
      } else {
        console.error("stripe_billing_portal_session_create_failed", {
          studioId: studio.id,
          customerId,
          hasConfiguration: Boolean(configuration),
          message: msg,
        });
        throw error;
      }
    }
    return { url: session.url };
  });

export const schedulePlatformSubscriptionCancellation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;
    await assertStudioOwnerAccess(sb, userId, data.studioId, { allowExpiredTrial: true });
    await rateLimitOrThrow({
      key: `billing-cancel:${userId}:${data.studioId}`,
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });

    const studio = await loadStudioForBilling(sb, data.studioId);
    const env = stripeEnv();
    const stripe = createStripeClient(env);
    const userEmail = await getUserEmail(sb, userId).catch(() => null);
    const storedSubscription = await loadSubscriptionForStudio(sb, studio.id, userId);
    const stripeSubscription = await findStripeSubscriptionForStudio(stripe, {
      customerId: storedSubscription?.stripe_customer_id ?? studio.stripe_customer_id ?? null,
      studioSubscriptionId:
        storedSubscription?.stripe_subscription_id ?? studio.stripe_subscription_id ?? null,
      studioId: studio.id,
      env,
      emails: [userEmail, studio.email],
    });

    if (!stripeSubscription || ["canceled", "incomplete_expired"].includes(stripeSubscription.status)) {
      return { scheduled: false, alreadyFree: true, effectiveAt: null };
    }

    let cancellableSubscription = stripeSubscription;
    const scheduleId = getSubscriptionScheduleId(stripeSubscription);
    if (scheduleId) {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      if (["active", "not_started"].includes(schedule.status)) {
        await stripe.subscriptionSchedules.release(schedule.id);
        cancellableSubscription = await stripe.subscriptions.retrieve(stripeSubscription.id);
      }
    }

    const updated = cancellableSubscription.cancel_at_period_end
      ? cancellableSubscription
      : await stripe.subscriptions.update(cancellableSubscription.id, {
          cancel_at_period_end: true,
        });

    await syncCheckoutSubscription(sb, updated, env, {
      userId,
      studioId: studio.id,
      customerId:
        typeof updated.customer === "string"
          ? updated.customer
          : storedSubscription?.stripe_customer_id ?? studio.stripe_customer_id ?? null,
    });

    const periodEnd = getCurrentPeriodEnd(updated);
    return {
      scheduled: true,
      alreadyFree: false,
      effectiveAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    };
  });

export const reactivatePlatformSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;
    await assertStudioOwnerAccess(sb, userId, data.studioId, { allowExpiredTrial: true });
    await rateLimitOrThrow({
      key: `billing-reactivate:${userId}:${data.studioId}`,
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });

    const studio = await loadStudioForBilling(sb, data.studioId);
    const storedSubscription = await loadSubscriptionForStudio(sb, studio.id, userId);
    const env = stripeEnv();
    const stripe = createStripeClient(env);
    const userEmail = await getUserEmail(sb, userId).catch(() => null);
    let subscription = await findStripeSubscriptionForStudio(stripe, {
      customerId: storedSubscription?.stripe_customer_id ?? studio.stripe_customer_id ?? null,
      studioSubscriptionId:
        storedSubscription?.stripe_subscription_id ?? studio.stripe_subscription_id ?? null,
      studioId: studio.id,
      env,
      emails: [userEmail, studio.email],
    });

    if (!subscription || ["canceled", "incomplete_expired"].includes(subscription.status)) {
      return { reactivated: false, requiresCheckout: true, paidAccess: false };
    }
    if (!["active", "trialing", "past_due", "unpaid"].includes(subscription.status)) {
      throw new Error("stripe_subscription_not_reactivatable");
    }

    let changed = false;
    const scheduleId = getSubscriptionScheduleId(subscription);
    if (scheduleId) {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      if (["active", "not_started"].includes(schedule.status) && schedule.end_behavior === "cancel") {
        await stripe.subscriptionSchedules.release(schedule.id, {
          preserve_cancel_date: false,
        });
        subscription = await stripe.subscriptions.retrieve(subscription.id, {
          expand: ["schedule"],
        });
        changed = true;
      }
    }

    if (subscription.cancel_at_period_end) {
      subscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
      });
      changed = true;
    }

    // Persist only the final Stripe object. The UI result never grants access;
    // entitlement continues to depend on an official active/trialing state.
    subscription = await stripe.subscriptions.retrieve(subscription.id, {
      expand: ["schedule"],
    });
    await syncCheckoutSubscription(sb, subscription, env, {
      userId,
      studioId: studio.id,
      customerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : storedSubscription?.stripe_customer_id ?? studio.stripe_customer_id ?? null,
    });

    const periodEnd = getCurrentPeriodEnd(subscription);
    const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
    return {
      reactivated: changed,
      requiresCheckout: false,
      paidAccess: hasPeriodAccess(subscription.status, currentPeriodEnd),
      status: subscription.status,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      currentPeriodEnd,
    };
  });

export const updatePlatformSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PlanChangeInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;
    await assertStudioOwnerAccess(sb, userId, data.studioId);
    await rateLimitOrThrow({
      key: `billing-plan-change:${userId}:${data.studioId}`,
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });

    const studio = await loadStudioForBilling(sb, data.studioId);
    const env = stripeEnv();
    const stripe = createStripeClient(env);
    const userEmail = await getUserEmail(sb, userId).catch(() => null);
    let existingSubscription = await loadSubscriptionForStudio(sb, studio.id, userId);
    existingSubscription =
      (await refreshSubscriptionFromStripe(sb, {
        userId,
        studioId: studio.id,
        customerId:
          existingSubscription?.stripe_customer_id ??
          studio.stripe_customer_id ??
          null,
        studioSubscriptionId:
          existingSubscription?.stripe_subscription_id ?? null,
        emails: [userEmail, studio.email],
        subscription: existingSubscription,
        env,
        reason: "before_plan_change",
        trialEndsAt: studio.trial_ends_at,
      }).catch((error) => {
        console.error("stripe_subscription_reconcile_before_plan_change_failed", {
          studioId: studio.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return existingSubscription;
      })) ?? existingSubscription;

    const stripeSubscription = await findStripeSubscriptionForStudio(stripe, {
      customerId:
        existingSubscription?.stripe_customer_id ??
        studio.stripe_customer_id ??
        null,
      studioSubscriptionId:
        existingSubscription?.stripe_subscription_id ??
        studio.stripe_subscription_id ??
        null,
      studioId: studio.id,
      env,
      emails: [userEmail, studio.email],
    });

    if (!stripeSubscription) {
      throw new Error("stripe_subscription_missing");
    }
    if (!["active", "trialing"].includes(stripeSubscription.status)) {
      throw new Error("stripe_checkout_required");
    }

    const plan = getSubscriptionPlan(env, data.plan);
    await validateStripeRecurringPrice(stripe, env, plan);
    const itemId = stripeSubscription.items.data[0]?.id;
    if (!itemId) throw new Error("stripe_subscription_item_missing");
    const currentPlanId = getPlanIdFromSubscription(env, stripeSubscription);
    if (stripeSubscription.items.data[0]?.price.id === plan.priceId) {
      return {
        pending: false,
        plan: currentPlanId,
        currentPeriodEnd: existingSubscription?.current_period_end ?? null,
      };
    }

    const currentPeriodEnd = getCurrentPeriodEnd(stripeSubscription);
    if (!currentPeriodEnd || currentPeriodEnd * 1000 <= Date.now()) {
      throw new Error("stripe_subscription_period_missing");
    }

    const currentItem = stripeSubscription.items.data[0];
    const currentPriceId = currentItem.price.id;
    const quantity = currentItem.quantity ?? 1;
    const scheduleId = getSubscriptionScheduleId(stripeSubscription);
    const schedule = scheduleId
      ? await stripe.subscriptionSchedules.retrieve(scheduleId)
      : await stripe.subscriptionSchedules.create({
          from_subscription: stripeSubscription.id,
        });
    const currentPhase = schedule.phases[0];
    const phaseStart =
      currentPhase?.start_date ??
      (stripeSubscription as Stripe.Subscription & { current_period_start?: number })
        .current_period_start ??
      Math.floor(Date.now() / 1000);

    const updatedSchedule = await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        {
          start_date: phaseStart,
          end_date: currentPeriodEnd,
          items: [{ price: currentPriceId, quantity }],
          metadata: {
            ...stripeSubscription.metadata,
            studio_id: studio.id,
            user_id: userId,
            plan: currentPlanId ?? "premium_monthly",
            plan_tier: existingSubscription?.plan_tier ?? "premium",
            billing_interval: existingSubscription?.plan ?? "monthly",
          },
        },
        {
          start_date: currentPeriodEnd,
          items: [{ price: plan.priceId, quantity }],
          metadata: {
            ...stripeSubscription.metadata,
            studio_id: studio.id,
            user_id: userId,
            plan: plan.id,
            plan_tier: plan.tier,
            billing_interval: plan.billingInterval,
          },
        },
      ],
      metadata: {
        managed_by: "bellza",
        studio_id: studio.id,
        user_id: userId,
        pending_plan: plan.id,
        pending_plan_tier: plan.tier,
      },
    } as any);

    console.info("stripe_subscription_plan_change_scheduled", {
      studioId: studio.id,
      subscriptionId: stripeSubscription.id,
      scheduleId: updatedSchedule.id,
      plan: plan.id,
      status: updatedSchedule.status,
    });

    return {
      pending: true,
      plan: currentPlanId,
      nextPlan: plan.id,
      effectiveAt: new Date(currentPeriodEnd * 1000).toISOString(),
      immediateCharge: false,
      scheduleId: updatedSchedule.id,
    };
  });
