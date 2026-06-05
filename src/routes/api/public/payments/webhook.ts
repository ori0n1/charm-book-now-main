import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { createStripeClient, type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import {
  getPlanByPriceId,
  getPlanIdFromSubscription,
  getSubscriptionPriceId,
} from "@/lib/subscription-plans.server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { markTrialUsed } from "@/lib/subscription-helpers";
import { sendAppointmentConfirmationMessage } from "@/lib/whatsapp.functions";

type StripeMetadata = Record<string, string | undefined>;
type StripePayload = Record<string, unknown> & {
  id?: string;
  customer?: string | null;
  subscription?: string | null;
  status?: string;
  failure_message?: string | null;
  failure_code?: string | null;
  receipt_url?: string | null;
  hosted_invoice_url?: string | null;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: StripeMetadata;
  lines?: { data?: Array<{ price?: { id?: string } }> };
};

type SubscriptionWithPeriodEnd = Stripe.Subscription & {
  current_period_end?: number | null;
  trial_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> };
};

function getCurrentPeriodEnd(subscription: Stripe.Subscription) {
  const extended = subscription as SubscriptionWithPeriodEnd;
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

async function handlePaymentIntent(
  pi: StripePayload,
  kind: "succeeded" | "failed" | "processing" | "canceled",
) {
  const sb = getAdminClient();
  const appointmentId = pi.metadata?.appointment_id;
  const bookingRequestId = pi.metadata?.booking_request_id;
  if (!appointmentId && !bookingRequestId) {
    // Silently ignore - no metadata means not a booking payment
    return;
  }

  const piStatus =
    kind === "succeeded"
      ? "succeeded"
      : kind === "processing"
        ? "processing"
        : kind === "canceled"
          ? "canceled"
          : "failed";

  if (!pi.id) return;

  const { data: previousPayment } = await sb
    .from("payment_intents")
    .select("status")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();

  await sb
    .from("payment_intents")
    .update({
      status: piStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_payment_intent_id", pi.id);

  if (kind === "succeeded") {
    if (bookingRequestId) {
      const { error } = await sb.rpc("confirm_paid_booking_request", {
        p_request_id: bookingRequestId,
        p_stripe_payment_intent_id: pi.id,
      });
      if (error) {
        await sb
          .from("booking_payment_requests")
          .update({
            status: "failed",
            failure_reason: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", bookingRequestId)
          .neq("status", "converted");
        await sb
          .from("payment_intents")
          .update({ failure_reason: error.message, updated_at: new Date().toISOString() })
          .eq("stripe_payment_intent_id", pi.id);
        throw new Error(error.message);
      }
      if (previousPayment?.status !== "succeeded") {
        await sendAppointmentConfirmationMessage(sb, { stripePaymentIntentId: pi.id }).catch(
          () => {
            // Silently ignore WhatsApp failures
          },
        );
      }
      return;
    }
    await sb
      .from("appointments")
      .update({
        status: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointmentId)
      .eq("status", "pending_payment");
    if (previousPayment?.status !== "succeeded") {
      await sendAppointmentConfirmationMessage(sb, { stripePaymentIntentId: pi.id }).catch(
        () => {
          // Silently ignore WhatsApp failures
        },
      );
    }
  } else if (kind === "failed" || kind === "canceled") {
    if (appointmentId) {
      await sb
        .from("appointments")
        .update({
          status: "cancelled",
          cancellation_reason: "payment_" + kind,
          updated_at: new Date().toISOString(),
        })
        .eq("id", appointmentId)
        .eq("status", "pending_payment");
    }
    if (bookingRequestId) {
      await sb
        .from("booking_payment_requests")
        .update({
          status: kind === "canceled" ? "canceled" : "failed",
          failure_reason: "payment_" + kind,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingRequestId)
        .in("status", ["awaiting_payment", "processing"]);
    }
  }
}

async function handleCheckoutSession(session: StripePayload, env: StripeEnv) {
  const studioId = session.metadata?.studio_id;
  const userId = session.metadata?.user_id;

  // Validate studio_id ownership before processing
  if (!userId || !studioId) {
    return;
  }

  if (typeof session.subscription === "string") {
    const stripe = createStripeClient(env);
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    await syncSubscription(subscription, env, {
      userId,
      studioId,
      customerId: typeof session.customer === "string" ? session.customer : null,
    });
    return;
  }
}

async function validateUserId(userId: string | null | undefined) {
  if (!userId) return null;
  const { data, error } = await getAdminClient().auth.admin.getUserById(userId);
  if (error || !data.user) {
    return null;
  }
  return userId;
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  env: StripeEnv,
  fallback?: { userId?: string | null; studioId?: string | null; customerId?: string | null },
) {
  const metadata = subscription.metadata ?? {};
  const userId = await validateUserId(metadata.user_id || fallback?.userId);
  const studioId = metadata.studio_id || fallback?.studioId || null;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : fallback?.customerId ?? null;
  const priceId = getSubscriptionPriceId(subscription);
  const planId = getPlanIdFromSubscription(env, subscription);
  const status = subscription.status ?? "incomplete";
  const periodEnd = getCurrentPeriodEnd(subscription);
  const currentPeriodEnd = periodEnd
    ? new Date(periodEnd * 1000).toISOString()
    : null;

  if (!userId || !studioId || !priceId || !planId) {
    // Invalid subscription data - silently ignore
    return;
  }

  const sb = getAdminClient();
  const { data: role, error: roleError } = await sb
    .from("user_roles")
    .select("studio_id")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .limit(1)
    .maybeSingle();
    
  if (roleError || !role?.studio_id) {
    // User doesn't own this studio - potential security breach attempt
    // Don't log as it could expose user/studio IDs
    return;
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
    .limit(1)
    .maybeSingle();
  if (pendingError) throw pendingError;

  const { error: subscriptionError } = pendingSubscription?.id
    ? await sb.from("subscriptions").update(subscriptionPatch).eq("id", pendingSubscription.id)
    : await sb.from("subscriptions").upsert(subscriptionPatch, {
        onConflict: "stripe_subscription_id",
      });
  if (subscriptionError) throw subscriptionError;

  // Mark trial as used when subscription enters trialing/active status (prevents reuse exploit)
  if (["trialing", "active"].includes(status) && studioId) {
    try {
      await markTrialUsed(sb, studioId);
    } catch {
      // Silently ignore if trial_used_at is already set (second webhook for same subscription)
    }
  }

  const patch = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: status,
    subscription_current_period_end: currentPeriodEnd,
    subscription_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    premium_access_until: activeAccess ? currentPeriodEnd : null,
    plan: activeAccess ? "pro" : "trial",
    updated_at: new Date().toISOString(),
  };

  const { error: studioError } = await sb.from("studios").update(patch).eq("id", studioId);
  if (studioError) throw studioError;
}

async function handleSubscription(subscription: StripePayload, env: StripeEnv) {
  await syncSubscription(subscription as unknown as Stripe.Subscription, env);
}

async function handleInvoice(invoice: StripePayload, env: StripeEnv) {
  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : null;
  if (subscriptionId) {
    const stripe = createStripeClient(env);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscription(subscription, env);
    return;
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  const priceId = invoice.lines?.data?.[0]?.price?.id ?? null;
  const plan = getPlanByPriceId(env, priceId);
  if (!customerId || !plan) return;

  const sb = getAdminClient();
  await sb
    .from("subscriptions")
    .update({
      status: invoice.status === "paid" ? "active" : "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId)
    .eq("stripe_price_id", plan.priceId);
}

async function syncWithdrawalRequest(
  obj: StripePayload,
  status: "processing" | "completed" | "failed" | "canceled",
) {
  const requestId = obj.metadata?.withdrawal_request_id;
  if (!requestId) return;

  const proofUrl =
    obj.receipt_url ||
    obj.hosted_invoice_url ||
    obj.metadata?.proof_url ||
    obj.metadata?.receipt_url ||
    null;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    status_updated_at: now,
    updated_at: now,
  };

  if (status === "processing") patch.processed_at = now;
  if (status === "completed") {
    patch.paid_at = now;
    patch.processed_at = now;
  }
  if (status === "failed") {
    patch.failure_reason = obj.failure_message || obj.failure_code || "Não foi possível concluir o levantamento.";
  }
  if (proofUrl) patch.proof_url = proofUrl;

  const sb = getAdminClient();
  const { error } = await sb
    .from("withdrawal_requests")
    .update(patch)
    .eq("id", requestId);
  if (error) throw error;
}

async function claimBillingEvent(event: {
  id?: string;
  type: string;
  data: { object: StripePayload };
}) {
  if (!event.id) return true;
  const obj = event.data.object;
  const studioId = obj.metadata?.studio_id;
  const sb = getAdminClient();
  const { error } = await sb
    .from("platform_billing_events")
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      studio_id: studioId ?? null,
      payload: event as unknown as Record<string, unknown>,
    });
  
  // Check for duplicate key error
  if (error && typeof error === "object" && "code" in error && error.code === "23505") {
    return false;
  }
  
  if (error) throw error;
  return true;
}

async function releaseBillingEventClaim(eventId?: string) {
  if (!eventId) return;
  const sb = getAdminClient();
  await sb.from("platform_billing_events").delete().eq("stripe_event_id", eventId);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  if (typeof event.livemode === "boolean" && event.livemode !== (env === "live")) {
    throw new Error("webhook_environment_mismatch");
  }
  const obj = event.data.object as StripePayload;
  const claimed = await claimBillingEvent(event as { id?: string; type: string; data: { object: StripePayload } });
  if (!claimed) return;
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntent(obj, "succeeded");
        break;
      case "payment_intent.processing":
        await handlePaymentIntent(obj, "processing");
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntent(obj, "failed");
        break;
      case "payment_intent.canceled":
        await handlePaymentIntent(obj, "canceled");
        break;
      case "checkout.session.completed":
        await handleCheckoutSession(obj, env);
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
        await handleInvoice(obj, env);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscription(obj, env);
        break;
      case "transfer.created":
      case "payout.created":
        await syncWithdrawalRequest(obj, "processing");
        break;
      case "transfer.paid":
      case "payout.paid":
        await syncWithdrawalRequest(obj, "completed");
        break;
      case "transfer.failed":
      case "payout.failed":
        await syncWithdrawalRequest(obj, "failed");
        break;
      case "payout.canceled":
        await syncWithdrawalRequest(obj, "canceled");
        break;
      default:
        break;
    }
  } catch (error) {
    await releaseBillingEventClaim(event.id);
    throw error;
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: false, error: "invalid_env" }, { status: 400 });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch {
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
