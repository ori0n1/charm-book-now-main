import { createServerFn } from "@tanstack/react-start";
import type Stripe from "stripe";
import { z } from "zod";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import {
  getSubscriptionPlans,
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
} from "@/lib/subscription-helpers";


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

    const subscription = await loadSubscriptionForStudio(sb, studio.id as string, (context as any).userId);
    const status = (subscription?.status ?? studio.subscription_status ?? "trialing") as string;
    const premiumUntil =
      subscription?.current_period_end ??
      studio.premium_access_until ??
      studio.subscription_current_period_end;
    const trialEndsAt = studio.trial_ends_at ?? null;
    const trialActive =
      status === "trialing" && trialEndsAt
        ? new Date(trialEndsAt as string).getTime() > Date.now()
        : status === "trialing" && Boolean(subscription);
    const premiumActive = status === "active" || trialActive;
    const daysRemaining = getDaysRemaining(
      status === "trialing" ? trialEndsAt : subscription?.current_period_end ?? studio.subscription_current_period_end,
    );

    return {
      available: true,
      plan: subscription?.plan ?? studio.plan ?? "trial",
      status,
      nextBillingAt:
        subscription?.current_period_end ??
        studio.subscription_current_period_end ??
        studio.trial_ends_at ??
        null,
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
    const plan = getSubscriptionPlans(stripeEnv())[data.plan ?? defaultPlanId()];
    const stripe = createStripeClient(stripeEnv());
    const customerId = await ensureCustomer(sb, stripe, studio);
    await assertNoDuplicateActiveSubscription(sb, studio.id);
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
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${appBaseUrl()}/admin/pagamentos?billing=success`,
      cancel_url: `${appBaseUrl()}/admin/pagamentos?billing=cancelled`,
      metadata: { studio_id: studio.id, user_id: userId, plan: plan.id },
      subscription_data: {
        metadata: { studio_id: studio.id, user_id: userId, plan: plan.id },
        ...(trialEnd ? { trial_end: trialEnd } : {}),
      },
    });
    return { url: session.url };
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
