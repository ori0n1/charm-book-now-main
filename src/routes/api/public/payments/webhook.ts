import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import { sendAppointmentConfirmationMessage } from "@/lib/whatsapp.functions";

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return _supabase;
}

type StripeMetadata = Record<string, string | undefined>;
type StripePayload = Record<string, unknown> & {
  id?: string;
  customer?: string | null;
  subscription?: string | null;
  status?: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: StripeMetadata;
};

async function handlePaymentIntent(
  pi: StripePayload,
  kind: "succeeded" | "failed" | "processing" | "canceled",
) {
  const sb = getSupabase();
  const appointmentId = pi.metadata?.appointment_id;
  const bookingRequestId = pi.metadata?.booking_request_id;
  if (!appointmentId && !bookingRequestId) {
    console.warn("payment_intent without reservation metadata", pi?.id);
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
          (sendError) => {
            console.error("twilio whatsapp confirmation failed", sendError);
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
        (sendError) => {
          console.error("twilio whatsapp confirmation failed", sendError);
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

async function handleCheckoutSession(session: StripePayload) {
  const studioId = session.metadata?.studio_id;
  if (!studioId) return;
  const sb = getSupabase();
  await sb
    .from("studios")
    .update({
      stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
      stripe_subscription_id:
        typeof session.subscription === "string" ? session.subscription : null,
      subscription_status: "active",
      plan: "pro",
      updated_at: new Date().toISOString(),
    })
    .eq("id", studioId);
}

async function handleSubscription(subscription: StripePayload) {
  const studioId = subscription.metadata?.studio_id;
  const customerId = typeof subscription?.customer === "string" ? subscription.customer : null;
  const sb = getSupabase();
  const patch = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription?.id ?? null,
    subscription_status: subscription?.status ?? "incomplete",
    subscription_current_period_end: subscription?.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    subscription_cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    premium_access_until: subscription?.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    plan: ["active", "trialing"].includes(subscription?.status) ? "pro" : "trial",
    updated_at: new Date().toISOString(),
  };

  if (studioId) {
    await sb.from("studios").update(patch).eq("id", studioId);
    return;
  }
  if (customerId) {
    await sb.from("studios").update(patch).eq("stripe_customer_id", customerId);
  }
}

async function logBillingEvent(event: {
  id?: string;
  type: string;
  data: { object: StripePayload };
}) {
  if (!event.id) return;
  const obj = event.data.object;
  const studioId = obj.metadata?.studio_id;
  await getSupabase()
    .from("platform_billing_events")
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      studio_id: studioId ?? null,
      payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .maybeSingle();
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  const obj = event.data.object as StripePayload;
  await logBillingEvent(event as { id?: string; type: string; data: { object: StripePayload } });
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
      await handleCheckoutSession(obj);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscription(obj);
      break;
    default:
      console.log("Unhandled stripe event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
