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
      invoices: await loadRecentInvoices(studio.stripe_customer_id as string | null),
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
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${appBaseUrl()}/admin/pagamentos?billing=success`,
      cancel_url: `${appBaseUrl()}/admin/pagamentos?billing=cancelled`,
      metadata: { studio_id: studio.id, user_id: userId, plan: plan.id },
      subscription_data: {
        metadata: { studio_id: studio.id, user_id: userId, plan: plan.id },
        ...(trialEndUnix(studio.trial_ends_at, studio.subscription_status)
          ? { trial_end: trialEndUnix(studio.trial_ends_at, studio.subscription_status) }
          : {}),
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

async function loadStudioForBilling(sb: SupabaseClient, studioId: string) {
  const { data, error } = await sb
    .from("studios")
    .select("id,name,email,stripe_customer_id,subscription_status,trial_ends_at")
    .eq("id", studioId)
    .maybeSingle();
  if (error || !data) throw new Error("studio_not_found");
  return data as {
    id: string;
    name: string;
    email: string | null;
    stripe_customer_id: string | null;
    subscription_status: string | null;
    trial_ends_at: string | null;
  };
}

async function ensureCustomer(
  sb: SupabaseClient,
  stripe: Stripe,
  studio: Awaited<ReturnType<typeof loadStudioForBilling>>,
) {
  if (studio.stripe_customer_id) return studio.stripe_customer_id;
  const customer = await stripe.customers.create({
    name: studio.name,
    email: studio.email ?? undefined,
    metadata: { studio_id: studio.id },
  });
  await sb.from("studios").update({ stripe_customer_id: customer.id }).eq("id", studio.id);
  return customer.id as string;
}

async function assertNoDuplicateActiveSubscription(sb: SupabaseClient, studioId: string) {
  const db = sb as any;
  const { data, error } = await db
    .from("subscriptions")
    .select("id,status")
    .eq("studio_id", studioId)
    .in("status", ["active", "trialing", "incomplete"])
    .maybeSingle();
  if (!error && data?.id) throw new Error("subscription_already_exists");
}

async function loadSubscriptionForStudio(sb: SupabaseClient, studioId: string, userId: string) {
  const db = sb as any;
  const { data } = await db
    .from("subscriptions")
    .select("plan,status,current_period_end,cancel_at_period_end")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as
    | {
        plan: string;
        status: string;
        current_period_end: string | null;
        cancel_at_period_end: boolean;
      }
    | null;
}

function getDaysRemaining(value?: string | null) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function trialEndUnix(trialEndsAt?: string | null, status?: string | null) {
  if (status && status !== "trialing") return null;
  if (!trialEndsAt) return null;
  const timestamp = Math.floor(new Date(trialEndsAt).getTime() / 1000);
  return timestamp > Math.floor(Date.now() / 1000) ? timestamp : null;
}

async function loadRecentInvoices(customerId: string | null) {
  if (!customerId) return [];
  try {
    const stripe = createStripeClient(stripeEnv());
    const invoices = await stripe.invoices.list({ customer: customerId, limit: 6 });
    return invoices.data.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      amountPaid: invoice.amount_paid,
      amountDue: invoice.amount_due,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
    }));
  } catch (error) {
    console.error("stripe invoices failed", error);
    return [];
  }
}
