import { createServerFn } from "@tanstack/react-start";
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
  return (
    process.env.APP_URL ??
    process.env.VITE_APP_URL ??
    process.env.PUBLIC_APP_URL ??
    "http://127.0.0.1:5173"
  ).replace(/\/$/, "");
}

function defaultPlanId(): SubscriptionPlanId {
  const value = process.env.DEFAULT_SUBSCRIPTION_PLAN ?? "monthly";
  return isSubscriptionPlanId(value) ? value : "monthly";
}

const StudioInput = z.object({
  studioId: z.string().uuid(),
  plan: z.enum(["monthly", "quarterly", "yearly"]).optional(),
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

  const activeAccess = ["active", "trialing"].includes(status);
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

  if (["trialing", "active"].includes(status)) {
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
    const subscriptionTrialActive =
      rawStatus === "trialing" &&
      (!subscription?.current_period_end ||
        new Date(subscription.current_period_end as string).getTime() > Date.now());
    const paidActive =
      rawStatus === "active" ||
      studio.subscription_status === "active" ||
      (studio.premium_access_until
        ? new Date(studio.premium_access_until as string).getTime() > Date.now()
        : false);
    const trialActive = Boolean(studioTrialActive || subscriptionTrialActive);
    const premiumActive = paidActive || trialActive;
    const status = paidActive ? "active" : trialActive ? "trialing" : rawStatus;
    const nextBillingAt =
      subscription?.current_period_end ??
      studio.subscription_current_period_end ??
      studio.trial_ends_at ??
      null;
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
      invoices: await loadRecentInvoices(stripeEnv(), studio.stripe_customer_id as string | null),
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
    const existingSubscription = await loadSubscriptionForStudio(sb, studio.id, userId);
    if (
      existingSubscription?.stripe_subscription_id &&
      !existingSubscription.stripe_subscription_id.startsWith("checkout_pending:") &&
      ["active", "trialing"].includes(existingSubscription.status)
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
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl()}/admin/pagamentos`,
    });
    return { url: session.url };
  });
