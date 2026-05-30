import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { z } from "zod";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess, rateLimitOrThrow } from "@/lib/server-security";

let _admin: ReturnType<typeof createClient> | null = null;

function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return _admin;
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

function platformPriceId() {
  const key =
    stripeEnv() === "live"
      ? process.env.STRIPE_LIVE_PLATFORM_PRICE_ID
      : process.env.STRIPE_SANDBOX_PLATFORM_PRICE_ID;
  if (!key) throw new Error("platform_price_not_configured");
  return key;
}

const StudioInput = z.object({ studioId: z.string().uuid() });

export const getPlatformSubscriptionSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
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
        cancelAtPeriodEnd: false,
        premiumActive: true,
        invoices: [],
      };
    }

    if (!studio) throw new Error("studio_not_found");

    const premiumUntil = studio.premium_access_until ?? studio.subscription_current_period_end;
    const premiumActive =
      ["trialing", "active"].includes(studio.subscription_status as string) ||
      (premiumUntil ? new Date(premiumUntil as string).getTime() > Date.now() : false);

    return {
      available: true,
      plan: studio.plan ?? "trial",
      status: studio.subscription_status ?? "trialing",
      nextBillingAt: studio.subscription_current_period_end ?? studio.trial_ends_at ?? null,
      cancelAtPeriodEnd: Boolean(studio.subscription_cancel_at_period_end),
      premiumActive,
      invoices: await loadRecentInvoices(studio.stripe_customer_id as string | null),
    };
  });

export const createPlatformCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId;
    await assertStudioAccess(sb, userId, data.studioId);
    await rateLimitOrThrow({
      key: `billing-checkout:${userId}:${data.studioId}`,
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });
    const studio = await loadStudioForBilling(sb, data.studioId);
    const stripe = createStripeClient(stripeEnv());
    const customerId = await ensureCustomer(sb, stripe, studio);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: platformPriceId(), quantity: 1 }],
      success_url: `${appBaseUrl()}/admin/pagamentos?billing=success`,
      cancel_url: `${appBaseUrl()}/admin/pagamentos?billing=cancelled`,
      metadata: { studio_id: studio.id },
      subscription_data: { metadata: { studio_id: studio.id } },
    });
    return { url: session.url };
  });

export const createPlatformBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
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
    .select("id,name,email,stripe_customer_id")
    .eq("id", studioId)
    .maybeSingle();
  if (error || !data) throw new Error("studio_not_found");
  return data as {
    id: string;
    name: string;
    email: string | null;
    stripe_customer_id: string | null;
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
