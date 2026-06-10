import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type Stripe from "stripe";
import { z } from "zod";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import {
  getSubscriptionPlans,
  getPlanByPriceId,
  getPlanIdFromSubscription,
  getSubscriptionPriceId,
  isSubscriptionPlanId,
  type SubscriptionPlanId,
} from "@/lib/subscription-plans.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess, rateLimitOrThrow } from "@/lib/server-security";
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

function priceRef(priceId: string) {
  return priceId.length > 8 ? `...${priceId.slice(-8)}` : priceId;
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
  return process.env.STRIPE_ENV === "live" ? "live" : "sandbox";
}

function appBaseUrl() {
  const configured = (
    process.env.APP_URL ??
    process.env.VITE_APP_URL ??
    process.env.PUBLIC_APP_URL ??
    ""
  ).replace(/\/$/, "");
  if (configured) return configured;

  const request = getRequest();
  const origin = request?.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  const host = request?.headers.get("host");
  if (host) {
    const proto = request?.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return "http://127.0.0.1:5173";
}

function defaultPlanId(): SubscriptionPlanId {
  const value = process.env.DEFAULT_SUBSCRIPTION_PLAN ?? "monthly";
  return isSubscriptionPlanId(value) ? value : "monthly";
}

const StudioInput = z.object({
  studioId: z.string().uuid(),
  plan: z.enum(["monthly", "quarterly", "yearly"]).optional(),
  action: z.enum(["manage", "cancel"]).optional(),
});

const PlanChangeInput = z.object({
  studioId: z.string().uuid(),
  plan: z.enum(["monthly", "quarterly", "yearly"]),
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
  const trialEnd = extended.trial_end;
  if (typeof trialEnd === "number") return trialEnd;
  const itemPeriodEnd = extended.items?.data?.[0]?.current_period_end;
  return typeof itemPeriodEnd === "number" ? itemPeriodEnd : null;
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
  const planId = getPlanIdFromSubscription(env, subscription);
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
  if (input.studioSubscriptionId && !input.studioSubscriptionId.startsWith("checkout_pending:")) {
    try {
      const subscription = await stripe.subscriptions.retrieve(input.studioSubscriptionId);
      if (getPlanIdFromSubscription(input.env, subscription)) {
        return subscription;
      }
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
    .filter((subscription) => getPlanIdFromSubscription(input.env, subscription))
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
  const userId = metadata.user_id === fallback.userId ? metadata.user_id : fallback.userId;
  const studioId = metadata.studio_id === fallback.studioId ? metadata.studio_id : fallback.studioId;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : fallback.customerId;
  const priceId = getSubscriptionPriceId(subscription);
  const planId = getPlanIdFromSubscription(env, subscription);
  const status = subscription.status ?? "incomplete";
  const periodEnd = getCurrentPeriodEnd(subscription);
  const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  if (!userId || !studioId || !customerId || !priceId || !planId) {
    throw new Error("stripe_subscription_sync_incomplete");
  }

  const activeAccess = hasPeriodAccess(status, currentPeriodEnd);
  const subscriptionPatch = {
    user_id: userId,
    studio_id: studioId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    plan: planId,
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
      plan: activeAccess ? "pro" : "trial",
      updated_at: new Date().toISOString(),
    })
    .eq("id", studioId);
  if (studioError) throw studioError;

  return { status, plan: planId, currentPeriodEnd };
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
  await syncCheckoutSubscription(sb, subscription, input.env, {
    userId: input.userId,
    studioId: input.studioId,
    customerId: typeof session.customer === "string" ? session.customer : input.customerId,
  });
  return true;
}

export const getPlatformSubscriptionSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertStudioAccess(sb, (context as any).userId, data.studioId);
    const { data: studio, error } = await sb
      .from("studios")
      .select(
        "id,email,plan,stripe_customer_id,stripe_subscription_id,subscription_status,subscription_current_period_end,subscription_cancel_at_period_end,premium_access_until,trial_ends_at",
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
        premiumActive: false,
        invoices: [],
      };
    }

    if (!studio) throw new Error("studio_not_found");

    const userId = (context as any).userId as string;
    const userEmail = await getUserEmail(sb, userId).catch(() => null);
    let subscription = await loadSubscriptionForStudio(sb, studio.id as string, userId);
    if (subscription?.status === "checkout_pending") {
      const recovered = await recoverPendingCheckout(sb, {
        userId,
        studioId: studio.id as string,
        customerId: studio.stripe_customer_id as string | null,
        env: stripeEnv(),
      }).catch((error) => {
        console.error("stripe_checkout_recovery_failed", {
          studioId: studio.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      });
      if (recovered) {
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
      }).catch((error) => {
        console.error("stripe_subscription_reconcile_failed", {
          studioId: studio.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return subscription;
      })) ?? subscription;
    const rawStatus = (subscription?.status ?? studio.subscription_status ?? "trialing") as string;
    const premiumUntil =
      subscription?.current_period_end ??
      studio.premium_access_until ??
      studio.subscription_current_period_end;
    const trialEndsAt = studio.trial_ends_at ?? null;
    const hasStripePlan = ["monthly", "quarterly", "yearly"].includes(subscription?.plan ?? "");
    const studioTrialActive =
      studio.subscription_status === "trialing" &&
      trialEndsAt &&
      new Date(trialEndsAt as string).getTime() > Date.now();
    const subscriptionTrialActive = rawStatus === "trialing" && hasPeriodAccess(rawStatus, premiumUntil);
    const paidActive =
      hasPeriodAccess(rawStatus, premiumUntil) ||
      hasPeriodAccess(studio.subscription_status as string, premiumUntil);
    const trialActive = Boolean(studioTrialActive || subscriptionTrialActive);
    const premiumActive = paidActive || trialActive;
    const status =
      rawStatus === "canceled" && paidActive
        ? "active"
        : paidActive && rawStatus !== "trialing"
          ? rawStatus
          : trialActive
            ? "trialing"
            : rawStatus;
    const rawNextBillingAt =
      subscription?.current_period_end ??
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

    return {
      available: true,
      plan: subscription?.plan ?? studio.plan ?? "trial",
      status,
      nextBillingAt,
      trialEndsAt,
      daysRemaining,
      cancelAtPeriodEnd: Boolean(
        subscription?.cancel_at_period_end ?? studio.subscription_cancel_at_period_end,
      ),
      pendingChange,
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
    await assertStudioAccess(sb, userId, data.studioId);
    await rateLimitOrThrow({
      key: `billing-checkout:${userId}:${data.studioId}`,
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });
    const studio = await loadStudioForBilling(sb, data.studioId);
    const env = stripeEnv();
    const plan = getSubscriptionPlans(env)[data.plan ?? defaultPlanId()];
    const stripe = createStripeClient(env);
    const userEmail = await getUserEmail(sb, userId).catch(() => null);
    const customerId = await ensureCustomer(sb, stripe, studio);
    await recoverPendingCheckout(sb, {
      userId,
      studioId: studio.id,
      customerId,
      env,
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
      const price = await stripe.prices.retrieve(plan.priceId);
      if (price.livemode !== (env === "live")) {
        throw new Error("stripe_price_environment_mismatch");
      }
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
    await reserveCheckoutSession(sb, {
      userId,
      studioId: studio.id,
      planId: plan.id,
      priceId: plan.priceId,
      customerId,
    });
    const trialEnd = trialEndUnix(
      studio.trial_ends_at,
      studio.subscription_status,
      studio.trial_used_at,
    );
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: plan.priceId, quantity: 1 }],
        success_url: `${appBaseUrl()}/admin/premium?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appBaseUrl()}/admin/premium?billing=cancelled`,
        metadata: { studio_id: studio.id, user_id: userId, plan: plan.id },
        subscription_data: {
          metadata: { studio_id: studio.id, user_id: userId, plan: plan.id },
          ...(trialEnd ? { trial_end: trialEnd } : {}),
        },
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
    return { url: session.url };
  });

export const syncPlatformCheckoutReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CheckoutReturnInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;
    await assertStudioAccess(sb, userId, data.studioId);
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
    await assertStudioAccess(sb, userId, data.studioId);
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
    const configuration = await ensureBillingPortalConfiguration(stripe, env, stripeSubscription);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration,
      return_url: `${appBaseUrl()}/admin/premium`,
      ...(data.action === "cancel" &&
      stripeSubscription?.id
        ? {
            flow_data: {
              type: "subscription_cancel",
              subscription_cancel: {
                subscription: stripeSubscription.id,
              },
              after_completion: {
                type: "redirect",
                redirect: {
                  return_url: `${appBaseUrl()}/admin/premium`,
                },
              },
            },
          }
        : {}),
    });
    return { url: session.url };
  });

export const updatePlatformSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PlanChangeInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;
    await assertStudioAccess(sb, userId, data.studioId);
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

    const plan = getSubscriptionPlans(env)[data.plan];
    const itemId = stripeSubscription.items.data[0]?.id;
    if (!itemId) throw new Error("stripe_subscription_item_missing");
    const currentPlanId = getPlanIdFromSubscription(env, stripeSubscription);
    if (currentPlanId === plan.id) {
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
            plan: currentPlanId ?? "monthly",
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
          },
        },
      ],
      metadata: {
        managed_by: "bellza",
        studio_id: studio.id,
        user_id: userId,
        pending_plan: plan.id,
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
