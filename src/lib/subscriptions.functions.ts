import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type Stripe from "stripe";
import { z } from "zod";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import {
  getSubscriptionPlans,
  getPlanByPriceId,
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
  if (status === "active" || status === "trialing") return true;
  if (!currentPeriodEnd) return false;
  const hasFutureAccess = new Date(currentPeriodEnd).getTime() > Date.now();
  return hasFutureAccess && (status === "canceled" || status === "past_due" || status === "unpaid");
}

function futureDateOrNull(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).getTime() > Date.now() ? value : null;
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

function subscriptionScore(subscription: Stripe.Subscription, env: StripeEnv) {
  const plan = getPlanByPriceId(env, getSubscriptionPriceId(subscription));
  if (!plan) return 999;
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
  return (statusRank[subscription.status] ?? 50) + futurePeriod;
}

async function findStripeSubscriptionForStudio(
  stripe: Stripe,
  input: {
    customerId: string;
    studioSubscriptionId: string | null;
    studioId: string;
    env: StripeEnv;
  },
) {
  if (input.studioSubscriptionId && !input.studioSubscriptionId.startsWith("checkout_pending:")) {
    try {
      const subscription = await stripe.subscriptions.retrieve(input.studioSubscriptionId);
      if (getPlanByPriceId(input.env, getSubscriptionPriceId(subscription))) {
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

  const subscriptions = await stripe.subscriptions.list({
    customer: input.customerId,
    status: "all",
    limit: 20,
  });
  return subscriptions.data
    .filter((subscription) => getPlanByPriceId(input.env, getSubscriptionPriceId(subscription)))
    .filter((subscription) => {
      const metadataStudioId = subscription.metadata?.studio_id;
      return !metadataStudioId || metadataStudioId === input.studioId;
    })
    .sort(
      (a, b) =>
        subscriptionScore(a, input.env) - subscriptionScore(b, input.env) ||
        (b.created ?? 0) - (a.created ?? 0),
    )[0];
}

async function refreshSubscriptionFromStripe(
  sb: ReturnType<typeof getAdminClient>,
  input: {
    userId: string;
    studioId: string;
    customerId: string | null;
    studioSubscriptionId: string | null;
    subscription: Awaited<ReturnType<typeof loadSubscriptionForStudio>>;
    env: StripeEnv;
    reason: string;
  },
) {
  if (!input.customerId) return input.subscription;
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
  const userId = metadata.user_id || fallback.userId;
  const studioId = metadata.studio_id || fallback.studioId;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : fallback.customerId;
  const priceId = getSubscriptionPriceId(subscription);
  const plan = getPlanByPriceId(env, priceId);
  const status = subscription.status ?? "incomplete";
  const periodEnd = getCurrentPeriodEnd(subscription);
  const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  if (!userId || !studioId || !customerId || !priceId || !plan) {
    throw new Error("stripe_subscription_sync_incomplete");
  }

  const activeAccess = hasPeriodAccess(status, currentPeriodEnd);
  const subscriptionPatch = {
    user_id: userId,
    studio_id: studioId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    plan: plan.id,
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

  return { status, plan: plan.id, currentPeriodEnd };
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
        "id,plan,stripe_customer_id,stripe_subscription_id,subscription_status,subscription_current_period_end,subscription_cancel_at_period_end,premium_access_until,trial_ends_at",
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
      rawStatus === "active" ||
      hasPeriodAccess(rawStatus, premiumUntil) ||
      studio.subscription_status === "active" ||
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
      premiumActive,
      invoices: await loadRecentInvoices(
        stripeEnv(),
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
      const portal = await stripe.billingPortal.sessions.create({
        customer: existingSubscription.stripe_customer_id ?? customerId,
        return_url: `${appBaseUrl()}/admin/pagamentos`,
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
        success_url: `${appBaseUrl()}/admin/pagamentos?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appBaseUrl()}/admin/pagamentos?billing=cancelled`,
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
    const stripe = createStripeClient(stripeEnv());
    const customerId = await ensureCustomer(sb, stripe, studio);
    await refreshSubscriptionFromStripe(sb, {
      userId,
      studioId: studio.id,
      customerId,
      studioSubscriptionId: null,
      subscription: await loadSubscriptionForStudio(sb, studio.id, userId),
      env: stripeEnv(),
      reason: "before_portal",
    }).catch((error) => {
      console.error("stripe_subscription_reconcile_before_portal_failed", {
        studioId: studio.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl()}/admin/pagamentos`,
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
    const customerId = await ensureCustomer(sb, stripe, studio);
    let existingSubscription = await loadSubscriptionForStudio(sb, studio.id, userId);
    existingSubscription =
      (await refreshSubscriptionFromStripe(sb, {
        userId,
        studioId: studio.id,
        customerId,
        studioSubscriptionId:
          existingSubscription?.stripe_subscription_id ?? null,
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

    if (
      !existingSubscription?.stripe_subscription_id ||
      existingSubscription.stripe_subscription_id.startsWith("checkout_pending:")
    ) {
      throw new Error("stripe_subscription_missing");
    }

    const plan = getSubscriptionPlans(env)[data.plan];
    const stripeSubscription = await stripe.subscriptions.retrieve(
      existingSubscription.stripe_subscription_id,
    );
    const itemId = stripeSubscription.items.data[0]?.id;
    if (!itemId) throw new Error("stripe_subscription_item_missing");

    const updated = await stripe.subscriptions.update(stripeSubscription.id, {
      cancel_at_period_end: false,
      items: [{ id: itemId, price: plan.priceId }],
      metadata: {
        ...stripeSubscription.metadata,
        studio_id: studio.id,
        user_id: userId,
        plan: plan.id,
      },
      proration_behavior: "create_prorations",
    });

    console.info("stripe_subscription_plan_changed", {
      studioId: studio.id,
      subscriptionId: updated.id,
      plan: plan.id,
      status: updated.status,
    });

    return syncCheckoutSubscription(sb, updated, env, {
      userId,
      studioId: studio.id,
      customerId,
    });
  });
