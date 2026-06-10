import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";

/**
 * Load studio data for payment/subscription operations
 * Consolidated from multiple implementations
 */
export async function loadPrimaryStudio(sb: SupabaseClient, userId: string) {
  const { data } = await sb
    .from("user_roles")
    .select("studio_id,studios(id,name,email,stripe_customer_id,subscription_status,trial_ends_at,trial_used_at)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  return (data?.studios ?? null) as
    | {
        id: string;
        name: string | null;
        email: string | null;
        stripe_customer_id: string | null;
        subscription_status: string | null;
        trial_ends_at: string | null;
        trial_used_at: string | null;
      }
    | null;
}

/**
 * Load studio for billing portal operations
 */
export async function loadStudioForBilling(sb: SupabaseClient, studioId: string) {
  const { data, error } = await sb
    .from("studios")
    .select("id,name,email,stripe_customer_id,stripe_subscription_id,subscription_status,trial_ends_at,trial_used_at")
    .eq("id", studioId)
    .maybeSingle();
  if (error || !data) throw new Error("studio_not_found");
  return data as {
    id: string;
    name: string;
    email: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    subscription_status: string | null;
    trial_ends_at: string | null;
    trial_used_at: string | null;
  };
}

/**
 * Ensure Stripe customer exists for studio
 * Creates if not found, updates DB with customer ID
 */
export async function ensureCustomer(
  sb: SupabaseClient,
  stripe: Stripe,
  studio: { id: string; name: string | null; email: string | null; stripe_customer_id: string | null },
) {
  if (studio.stripe_customer_id) {
    try {
      const existing = await stripe.customers.retrieve(studio.stripe_customer_id);
      if (!existing.deleted) return existing.id as string;
    } catch {
      // A sandbox customer ID can be stored before switching Stripe to live.
      // In that case create a fresh live customer and replace the stale ID.
    }
  }

  const customer = await stripe.customers.create({
    name: studio.name ?? undefined,
    email: studio.email ?? undefined,
    metadata: { studio_id: studio.id },
  });

  await sb.from("studios").update({ stripe_customer_id: customer.id }).eq("id", studio.id);
  return customer.id as string;
}

/**
 * Ensure no duplicate active subscription for studio
 * Pending checkout rows are handled by reserveCheckoutSession/recovery.
 * Prevents multiple concurrent billing relationships
 */
export async function assertNoDuplicateActiveSubscription(sb: SupabaseClient, studioId: string) {
  const { data, error } = await sb
    .from("subscriptions")
    .select("id,status")
    .eq("studio_id", studioId)
    .in("status", ["active", "trialing", "incomplete"])
    .maybeSingle();

  if (!error && data?.id) throw new Error("subscription_already_exists");
}

/**
 * Load current subscription for studio
 */
export async function loadSubscriptionForStudio(sb: SupabaseClient, studioId: string, userId: string) {
  const { data } = await sb
    .from("subscriptions")
    .select("plan,status,current_period_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id")
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
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
      }
    | null;
}

/**
 * Get trial end time as Unix timestamp
 * Only valid if status is "trialing" and trial hasn't expired
 */
export function trialEndUnix(trialEndsAt?: string | null, status?: string | null, trialUsedAt?: string | null): number | null {
  // Only return if currently in trialing status
  if (status && status !== "trialing") return null;
  if (!trialEndsAt) return null;
  // Prevent reuse - if trial already claimed, don't allow another one
  if (trialUsedAt) return null;

  const timestamp = Math.floor(new Date(trialEndsAt).getTime() / 1000);
  // Only return if trial hasn't expired yet
  return timestamp > Math.floor(Date.now() / 1000) ? timestamp : null;
}

/**
 * Calculate days remaining until expiration
 */
export function getDaysRemaining(value?: string | null): number | null {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

/**
 * Mark trial as used when subscription becomes active/trialing
 * Prevents exploit where user could cancel and restart trial infinitely
 */
export async function markTrialUsed(sb: SupabaseClient, studioId: string) {
  const { error } = await sb
    .from("studios")
    .update({ trial_used_at: new Date().toISOString() })
    .eq("id", studioId)
    .is("trial_used_at", null); // Only mark if not already marked
  
  if (error) throw error;
}

/**
 * Create a checkout_pending subscription record to prevent race condition
 * This reserves the checkout and prevents concurrent checkout sessions
 * The stripe webhook will update this to "active" or "trialing"
 */
export async function reserveCheckoutSession(
  sb: SupabaseClient,
  input: {
    userId: string;
    studioId: string;
    planId: string;
    priceId: string;
    customerId: string;
  },
) {
  await sb
    .from("subscriptions")
    .delete()
    .eq("studio_id", input.studioId)
    .eq("user_id", input.userId)
    .eq("status", "checkout_pending");

  const { error } = await sb.from("subscriptions").insert({
    user_id: input.userId,
    studio_id: input.studioId,
    stripe_customer_id: input.customerId,
    stripe_subscription_id: `checkout_pending:${input.studioId}`,
    stripe_price_id: input.priceId,
    plan: input.planId,
    status: "checkout_pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
}

/**
 * Remove a checkout reservation when Stripe session creation fails.
 */
export async function releaseCheckoutSession(
  sb: SupabaseClient,
  input: {
    userId: string;
    studioId: string;
  },
) {
  await sb
    .from("subscriptions")
    .delete()
    .eq("studio_id", input.studioId)
    .eq("user_id", input.userId)
    .eq("status", "checkout_pending");
}

/**
 * Load recent Stripe invoices for customer
 */
export async function loadRecentInvoices(stripeEnv: StripeEnv, customerId: string | null) {
  if (!customerId) return [];

  try {
    const stripe = createStripeClient(stripeEnv);
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
  } catch {
    return [];
  }
}
