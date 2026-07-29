import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import {
  assertStripeProductionConfig,
  createStripeClient,
  type StripeEnv,
  verifyWebhook,
  verifyWebhookBody,
} from "@/lib/stripe.server";
import {
  getPlanByPriceId,
  getPlanIdFromSubscription,
  getSubscriptionPriceId,
} from "@/lib/subscription-plans.server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { markTrialUsed } from "@/lib/subscription-helpers";
import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";
import { sendAppointmentConfirmationMessage } from "@/lib/whatsapp.functions";
import { processReferralsOnPayment, rejectReferralOnCancellation } from "@/lib/referrals.functions";
import { syncConnectAccountFromWebhook } from "@/lib/stripe-connect.functions";
import { handleInPersonMbWayPaymentIntent } from "@/lib/in-person-mbway.functions";

type StripeMetadata = Record<string, string | undefined>;
type StripePayload = Record<string, unknown> & {
  id?: string;
  amount?: number | null;
  amount_received?: number | null;
  amount_total?: number | null;
  latest_charge?: string | StripePayload | null;
  currency?: string | null;
  customer?: string | null;
  payment_intent?: string | StripePayload | null;
  payment_status?: string | null;
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

type StripeWebhookEvent = {
  id?: string;
  type: string;
  livemode?: boolean;
  account?: string;
  data: { object: StripePayload };
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
  if (status === "active") {
    return !currentPeriodEnd || new Date(currentPeriodEnd).getTime() > Date.now();
  }
  if (status === "trialing") {
    return Boolean(currentPeriodEnd && new Date(currentPeriodEnd).getTime() > Date.now());
  }
  return false;
}

function currencyMatches(left?: string | null, right?: string | null) {
  return (left || "eur").toLowerCase() === (right || "eur").toLowerCase();
}

async function loadReservedBookingPayment(
  sb: ReturnType<typeof getAdminClient>,
  input: {
    stripePaymentIntentId: string;
    bookingRequestId?: string | null;
    appointmentId?: string | null;
  },
) {
  const select =
    "id,studio_id,appointment_id,booking_request_id,amount_cents,currency,status,stripe_payment_intent_id,stripe_checkout_session_id,stripe_connect_account_id,booking_payment_requests:booking_request_id(id,studio_id,status,total_price),appointments:appointment_id(id,studio_id,status,total_price)";

  const byStripe = await (sb as any)
    .from("payment_intents")
    .select(select)
    .eq("stripe_payment_intent_id", input.stripePaymentIntentId)
    .maybeSingle();
  if (byStripe.error) throw byStripe.error;
  if (byStripe.data?.id) return byStripe.data;

  if (input.bookingRequestId) {
    const byBooking = await (sb as any)
      .from("payment_intents")
      .select(select)
      .eq("booking_request_id", input.bookingRequestId)
      .is("stripe_payment_intent_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byBooking.error) throw byBooking.error;
    if (byBooking.data?.id) return byBooking.data;
  }

  if (input.appointmentId) {
    const byAppointment = await (sb as any)
      .from("payment_intents")
      .select(select)
      .eq("appointment_id", input.appointmentId)
      .is("stripe_payment_intent_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byAppointment.error) throw byAppointment.error;
    if (byAppointment.data?.id) return byAppointment.data;
  }

  return null;
}

function assertBookingPaymentMatchesStripe(row: any, pi: StripePayload) {
  const metadata = pi.metadata ?? {};
  const amountReceived = Number(pi.amount_received ?? pi.amount ?? 0);
  const expectedAmount = Number(row.amount_cents || 0);
  if (!row?.id) throw new Error("payment_reservation_missing");
  if (expectedAmount <= 0 || amountReceived < expectedAmount) {
    throw new Error("payment_amount_mismatch");
  }
  if (!currencyMatches(row.currency as string | null, pi.currency)) {
    throw new Error("payment_currency_mismatch");
  }
  if (metadata.studio_id && metadata.studio_id !== row.studio_id) {
    throw new Error("payment_studio_mismatch");
  }
  if (metadata.booking_request_id && row.booking_request_id && metadata.booking_request_id !== row.booking_request_id) {
    throw new Error("payment_booking_mismatch");
  }
  if (metadata.appointment_id && row.appointment_id && metadata.appointment_id !== row.appointment_id) {
    throw new Error("payment_appointment_mismatch");
  }
}

function extractLatestChargeId(pi: StripePayload) {
  const latest = pi.latest_charge;
  if (typeof latest === "string") return latest;
  if (latest && typeof latest === "object" && typeof latest.id === "string") return latest.id;
  return null;
}

async function loadStripeFinancialPatch(
  env: StripeEnv,
  pi: StripePayload,
  stripeAccount?: string | null,
) {
  const chargeId = extractLatestChargeId(pi);
  if (!chargeId) {
    return { financial_details_status: "pending" };
  }

  const stripe = createStripeClient(env);
  const charge = await stripe.charges.retrieve(
    chargeId,
    { expand: ["balance_transaction"] },
    stripeAccount ? { stripeAccount } : undefined,
  );
  const balanceTransaction =
    typeof charge.balance_transaction === "object" && charge.balance_transaction
      ? charge.balance_transaction
      : null;

  if (!balanceTransaction) {
    return {
      stripe_charge_id: charge.id,
      financial_details_status: "pending",
    };
  }

  return {
    stripe_charge_id: charge.id,
    stripe_balance_transaction_id: balanceTransaction.id,
    gross_amount_cents: Number(balanceTransaction.amount || charge.amount || pi.amount_received || pi.amount || 0),
    stripe_fee_cents: Number(balanceTransaction.fee || 0),
    net_amount_cents: Number(balanceTransaction.net || 0),
    available_on: balanceTransaction.available_on
      ? new Date(balanceTransaction.available_on * 1000).toISOString()
      : null,
    financial_details_status: "confirmed",
  };
}

async function handlePaymentIntent(
  pi: StripePayload,
  kind: "succeeded" | "failed" | "processing" | "canceled",
  stripeAccount?: string | null,
  env: StripeEnv = "live",
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

  const reservedPayment = await loadReservedBookingPayment(sb, {
    stripePaymentIntentId: pi.id,
    bookingRequestId,
    appointmentId,
  });
  if (!reservedPayment?.id) {
    throw new Error("payment_reservation_missing");
  }
  assertBookingPaymentMatchesStripe(reservedPayment, pi);

  const financialPatch =
    kind === "succeeded"
      ? await loadStripeFinancialPatch(env, pi, stripeAccount).catch((error) => {
          console.error("[payments-webhook] financial_details_load_failed", {
            stripe_payment_intent_id: pi.id,
            stripe_account: stripeAccount ?? null,
            reason: error instanceof Error ? error.message : String(error),
          });
          return { financial_details_status: "pending" };
        })
      : {};

  const paymentPatch = {
    stripe_payment_intent_id: pi.id,
    stripe_connect_account_id: stripeAccount ?? reservedPayment.stripe_connect_account_id ?? null,
    status: piStatus,
    ...financialPatch,
    updated_at: new Date().toISOString(),
  };

  const { data: updatedByStripeId } = await sb
    .from("payment_intents")
    .update(paymentPatch)
    .eq("stripe_payment_intent_id", pi.id)
    .select("id");

  if ((!updatedByStripeId || updatedByStripeId.length === 0) && bookingRequestId) {
    await sb
      .from("payment_intents")
      .update(paymentPatch)
      .eq("booking_request_id", bookingRequestId)
      .is("stripe_payment_intent_id", null);
  }

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
      if (reservedPayment.status !== "succeeded") {
        await sendAppointmentConfirmationMessage(sb, { stripePaymentIntentId: pi.id }).catch(
          (error) => {
            console.error("[payments-webhook] whatsapp_confirmation_failed", {
              stripe_payment_intent_id: pi.id,
              booking_request_id: bookingRequestId,
              error,
            });
          },
        );
        await dispatchStudioPushForPayment(sb, {
          studioId: String(reservedPayment.studio_id),
          bookingRequestId,
          appointmentId: null,
        });
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
    if (reservedPayment.status !== "succeeded") {
      await sendAppointmentConfirmationMessage(sb, { stripePaymentIntentId: pi.id }).catch(
        (error) => {
          console.error("[payments-webhook] whatsapp_confirmation_failed", {
            stripe_payment_intent_id: pi.id,
            appointment_id: appointmentId,
            error,
          });
        },
      );
      await dispatchStudioPushForPayment(sb, {
        studioId: String(reservedPayment.studio_id),
        bookingRequestId: null,
        appointmentId: appointmentId ?? null,
      });
    }
  } else if (kind === "processing") {
    if (bookingRequestId) {
      await sb
        .from("booking_payment_requests")
        .update({
          status: "processing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingRequestId)
        .in("status", ["awaiting_payment", "processing"]);
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
    if (reservedPayment.status !== piStatus) {
      await dispatchStudioPushForPayment(sb, {
        studioId: String(reservedPayment.studio_id),
        bookingRequestId,
        appointmentId: appointmentId ?? null,
      });
    }
  }
}

async function dispatchStudioPushForPayment(
  sb: ReturnType<typeof getAdminClient>,
  input: { studioId: string; bookingRequestId?: string | null; appointmentId?: string | null },
) {
  let appointmentId = input.appointmentId ?? null;
  if (!appointmentId && input.bookingRequestId) {
    const { data } = await (sb as any)
      .from("booking_payment_requests")
      .select("appointment_id")
      .eq("id", input.bookingRequestId)
      .eq("studio_id", input.studioId)
      .maybeSingle();
    appointmentId = data?.appointment_id ?? null;
  }
  console.info("[payments-webhook] studio_push_dispatch_after_payment", {
    studio_id: input.studioId,
    booking_request_id: input.bookingRequestId ?? null,
    appointment_id: appointmentId,
  });
  await dispatchPendingStudioPushNotifications({
    studioId: input.studioId,
    appointmentId: appointmentId ?? undefined,
  }).catch((error) => {
    console.error("[payments-webhook] studio_push_dispatch_failed", {
      studio_id: input.studioId,
      appointment_id: appointmentId,
      error,
    });
  });
}

async function handleCheckoutSession(session: StripePayload, env: StripeEnv, stripeAccount?: string | null) {
  if (isBookingCheckoutSession(session)) {
    await handleBookingCheckoutSession(session, env, stripeAccount);
    return;
  }

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

function isBookingCheckoutSession(session: StripePayload) {
  return (
    session.metadata?.payment_kind === "booking_deposit" ||
    Boolean(session.metadata?.booking_request_id || session.metadata?.appointment_id)
  );
}

async function handleBookingCheckoutSession(session: StripePayload, env: StripeEnv, stripeAccount?: string | null) {
  const metadata = session.metadata ?? {};
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : typeof session.payment_intent?.id === "string"
        ? session.payment_intent.id
        : null;

  if (!paymentIntentId) return;

  const stripe = createStripeClient(env);
  const paymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    undefined,
    stripeAccount ? { stripeAccount } : undefined,
  );
  const mergedMetadata = {
    ...metadata,
    ...(paymentIntent.metadata ?? {}),
  };

  const paid =
    session.payment_status === "paid" ||
    paymentIntent.status === "succeeded";

  await handlePaymentIntent(
    {
      id: paymentIntent.id,
      amount: paymentIntent.amount_received || paymentIntent.amount || session.amount_total || 0,
      amount_received: paymentIntent.amount_received,
      currency: paymentIntent.currency || session.currency || "eur",
      latest_charge:
        typeof paymentIntent.latest_charge === "string" || paymentIntent.latest_charge === null
          ? paymentIntent.latest_charge
          : undefined,
      metadata: mergedMetadata,
      status: paymentIntent.status,
    },
    paid ? "succeeded" : paymentIntent.status === "processing" ? "processing" : "failed",
    stripeAccount,
    env,
  );
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

  // Referral processing: check if 30-day hold has passed for pending referrals
  if (status === "active" && studioId) {
    try {
      await processReferralsOnPayment(studioId);
    } catch (err) {
      // Non-critical: log but don't fail the webhook
      console.error("[webhook] referral processing failed", err instanceof Error ? err.message : err);
    }
  }

  // Referral rejection: cancel within hold period
  if (status === "canceled" && studioId) {
    try {
      await rejectReferralOnCancellation(studioId);
    } catch (err) {
      console.error("[webhook] referral rejection failed", err instanceof Error ? err.message : err);
    }
  }
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
    patch.failure_reason = obj.failure_message || obj.failure_code || "Não foi possível concluir o registo financeiro.";
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

async function processWebhookEvent(
  event: StripeWebhookEvent,
  env: StripeEnv,
) {
  console.info("[stripe-webhook] event_received", {
    eventId: event.id ?? null,
    type: event.type,
    livemode: event.livemode ?? null,
    connectAccount: event.account ?? null,
  });
  if (typeof event.livemode === "boolean" && event.livemode !== (env === "live")) {
    throw new Error("webhook_environment_mismatch");
  }
  const obj = event.data.object;
  const sb = getAdminClient();
  const claimed = await claimBillingEvent(event as { id?: string; type: string; data: { object: StripePayload } });
  if (!claimed) {
    console.info("[stripe-webhook] event_duplicate_ignored", {
      eventId: event.id ?? null,
      type: event.type,
    });
    return;
  }
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        {
          const inPersonMbWay = await handleInPersonMbWayPaymentIntent(obj, "succeeded");
          if (inPersonMbWay.handled) {
            if (inPersonMbWay.previousStatus !== "succeeded" && inPersonMbWay.studioId) {
              await dispatchStudioPushForPayment(sb, {
                studioId: inPersonMbWay.studioId,
                bookingRequestId: null,
                appointmentId: inPersonMbWay.appointmentId ?? null,
              });
            }
            break;
          }
        }
        await handlePaymentIntent(obj, "succeeded", event.account ?? null, env);
        break;
      case "payment_intent.processing":
        {
          const inPersonMbWay = await handleInPersonMbWayPaymentIntent(obj, "processing");
          if (inPersonMbWay.handled) break;
        }
        await handlePaymentIntent(obj, "processing", event.account ?? null, env);
        break;
      case "payment_intent.payment_failed":
        {
          const inPersonMbWay = await handleInPersonMbWayPaymentIntent(obj, "failed");
          if (inPersonMbWay.handled) break;
        }
        await handlePaymentIntent(obj, "failed", event.account ?? null, env);
        break;
      case "payment_intent.canceled":
        {
          const inPersonMbWay = await handleInPersonMbWayPaymentIntent(obj, "canceled");
          if (inPersonMbWay.handled) break;
        }
        await handlePaymentIntent(obj, "canceled", event.account ?? null, env);
        break;
      case "checkout.session.completed":
        await handleCheckoutSession(obj, env, event.account ?? null);
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
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        await syncWithdrawalRequest(obj, "processing");
        break;
      case "transfer.paid":
      case "payout.paid":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        await syncWithdrawalRequest(obj, "completed");
        break;
      case "transfer.failed":
      case "payout.failed":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        await syncWithdrawalRequest(obj, "failed");
        break;
      case "payout.canceled":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        await syncWithdrawalRequest(obj, "canceled");
        break;
      case "balance.available":
      case "account.updated":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        else if (typeof obj.id === "string" && obj.id.startsWith("acct_")) await syncConnectAccountFromWebhook(obj.id);
        break;
      default:
        break;
    }
    console.info("[stripe-webhook] event_processed", {
      eventId: event.id ?? null,
      type: event.type,
    });
  } catch (error) {
    await releaseBillingEventClaim(event.id);
    throw error;
  }
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = (await verifyWebhook(req, env)) as {
    id?: string;
    type: string;
    livemode?: boolean;
    account?: string;
    data: { object: StripePayload };
  };
  await processWebhookEvent(event, env);
}

async function handleWebhookWithoutEnv(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const event = (await verifyWebhookBody(body, signature, "live")) as {
    id?: string;
    type: string;
    livemode?: boolean;
    account?: string;
    data: { object: StripePayload };
  };
  await processWebhookEvent(event, "live");
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        try {
          assertStripeProductionConfig("live");
          if (rawEnv && rawEnv !== "live") {
            throw new Error("stripe_live_only_webhook");
          }
          if (rawEnv === "live") {
            await handleWebhook(request, "live");
          } else {
            await handleWebhookWithoutEnv(request);
          }
          return Response.json({ received: true });
        } catch (error) {
          console.error("stripe_webhook_failed", {
            reason: error instanceof Error ? error.message : "unknown",
          });
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
