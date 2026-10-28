import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import {
  assertStripeRuntimeConfig,
  createStripeClient,
  getConfiguredStripeEnv,
  type StripeEnv,
  verifyWebhook,
} from "@/lib/stripe.server";
import {
  getPlanByPriceId,
  getPlanConfigFromSubscription,
  getSubscriptionPriceId,
  stripeRecurringPriceMatchesPlan,
} from "@/lib/subscription-plans.server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { markTrialUsed } from "@/lib/subscription-helpers";
import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";
import { sendAppointmentConfirmationMessage } from "@/lib/whatsapp.functions";
import { notifyPaidBookingRequiresReview } from "@/lib/paid-booking-alert.server";
import { isTerminalPaidBookingError, paidBookingRecoveryErrorCode } from "@/lib/paid-booking-recovery-state";
import { processReferralsOnPayment, rejectReferralOnCancellation } from "@/lib/referrals.functions";
import { syncConnectAccountFromWebhook } from "@/lib/stripe-connect.functions";
import { handleInPersonMbWayPaymentIntent } from "@/lib/in-person-mbway.functions";
import {
  assertDirectChargeAccount,
  assertExactStripeAmount,
  assertWithdrawalWebhookBinding,
  minimalStripeEventAudit,
  resolveBookingPaymentStatus,
} from "@/lib/stripe-financial-integrity";

type StripeMetadata = Record<string, string | undefined>;
type StripePayload = Record<string, unknown> & {
  id?: string;
  object?: string;
  amount?: number | null;
  amount_received?: number | null;
  amount_refunded?: number | null;
  refunded?: boolean | null;
  amount_total?: number | null;
  charge?: string | StripePayload | null;
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
  created?: number;
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
  const itemPeriodEnd = extended.items?.data?.[0]?.current_period_end;
  if (typeof itemPeriodEnd === "number") return itemPeriodEnd;
  const trialEnd = extended.trial_end;
  return typeof trialEnd === "number" ? trialEnd : null;
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
    checkoutSessionId?: string | null;
  },
) {
  const select =
    "id,studio_id,appointment_id,booking_request_id,amount_cents,currency,status,stripe_payment_intent_id,stripe_checkout_session_id,stripe_connect_account_id,booking_payment_requests:booking_request_id(id,studio_id,status,total_price,client_name,client_phone,client_email)";

  const byStripe = await (sb as any)
    .from("payment_intents")
    .select(select)
    .eq("stripe_payment_intent_id", input.stripePaymentIntentId)
    .maybeSingle();
  if (byStripe.error) throw byStripe.error;
  if (byStripe.data?.id) return byStripe.data;

  if (input.checkoutSessionId) {
    const bySession = await (sb as any).from("payment_intents")
      .select(select)
      .eq("stripe_checkout_session_id", input.checkoutSessionId)
      .maybeSingle();
    if (bySession.error) throw bySession.error;
    if (bySession.data?.id) {
      if (bySession.data.stripe_payment_intent_id &&
          bySession.data.stripe_payment_intent_id !== input.stripePaymentIntentId) {
        throw new Error("checkout_payment_intent_mismatch");
      }
      return bySession.data;
    }
  }

  if (input.appointmentId) {
    const byAppointment = await (sb as any)
      .from("payment_intents")
      .select(select)
      .eq("appointment_id", input.appointmentId)
      .is("stripe_payment_intent_id", null)
      .order("created_at", { ascending: false })
      .limit(2);
    if (byAppointment.error) throw byAppointment.error;
    if ((byAppointment.data ?? []).length > 1) throw new Error("payment_reservation_ambiguous");
    if (byAppointment.data?.[0]?.id) return byAppointment.data[0];
  }

  return null;
}

function assertBookingPaymentMatchesStripe(row: any, pi: StripePayload) {
  const metadata = pi.metadata ?? {};
  const expectedAmount = Number(row.amount_cents || 0);
  if (!row?.id) throw new Error("payment_reservation_missing");
  assertExactStripeAmount({
    expectedAmountCents: expectedAmount,
    stripeAmountCents: Number(pi.amount ?? 0),
    receivedAmountCents: Number(pi.amount_received ?? 0),
    succeeded: pi.status === "succeeded",
  });
  if (!currencyMatches(row.currency as string | null, pi.currency)) {
    throw new Error("payment_currency_mismatch");
  }
  if (metadata.studio_id !== row.studio_id) {
    throw new Error("payment_studio_mismatch");
  }
  if (row.booking_request_id && metadata.booking_request_id !== row.booking_request_id) {
    throw new Error("payment_booking_mismatch");
  }
  const bookingRequest = Array.isArray(row.booking_payment_requests)
    ? row.booking_payment_requests[0] : row.booking_payment_requests;
  const comparablePhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (/^9\d{8}$/.test(digits)) return `351${digits}`;
    if (/^003519\d{8}$/.test(digits)) return digits.slice(2);
    return digits;
  };
  if (row.booking_request_id && metadata.client_phone && bookingRequest?.client_phone &&
      comparablePhone(metadata.client_phone) !== comparablePhone(bookingRequest.client_phone)) {
    throw new Error("payment_client_phone_mismatch");
  }
  if (row.appointment_id && !row.booking_request_id && metadata.appointment_id !== row.appointment_id) {
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
  let charge: Stripe.Charge | null = null;
  let balanceTransaction: Stripe.BalanceTransaction | null = null;
  for (let attempt = 0; attempt < 5 && !balanceTransaction; attempt += 1) {
    charge = await stripe.charges.retrieve(
      chargeId,
      { expand: ["balance_transaction"] },
      stripeAccount ? { stripeAccount } : undefined,
    );
    if (typeof charge.balance_transaction === "object" && charge.balance_transaction) {
      balanceTransaction = charge.balance_transaction;
    } else if (typeof charge.balance_transaction === "string") {
      balanceTransaction = await stripe.balanceTransactions.retrieve(
        charge.balance_transaction,
        {},
        stripeAccount ? { stripeAccount } : undefined,
      );
    }
    if (!balanceTransaction && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  if (!charge || !balanceTransaction) {
    return {
      stripe_charge_id: charge?.id ?? chargeId,
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

  let checkoutSessionId = pi.metadata?.stripe_checkout_session_id ?? null;
  if (bookingRequestId && !checkoutSessionId && stripeAccount) {
    const sessions = await createStripeClient(env).checkout.sessions.list(
      { payment_intent: pi.id, limit: 2 },
      { stripeAccount },
    );
    if (sessions.data.length === 1) checkoutSessionId = sessions.data[0].id;
  }

  const reservedPayment = await loadReservedBookingPayment(sb, {
    stripePaymentIntentId: pi.id,
    bookingRequestId,
    appointmentId,
    checkoutSessionId,
  });
  if (!reservedPayment?.id) {
    if (kind === "succeeded" && bookingRequestId && pi.metadata?.studio_id && stripeAccount) {
      const [{ data: request }, { data: studio }] = await Promise.all([
        sb.from("booking_payment_requests").select("id,studio_id")
          .eq("id", bookingRequestId).eq("studio_id", pi.metadata.studio_id).maybeSingle(),
        sb.from("studios").select("id,stripe_connect_account_id")
          .eq("id", pi.metadata.studio_id).maybeSingle(),
      ]);
      if (request?.id && studio?.stripe_connect_account_id === stripeAccount) {
        const { error: markError } = await sb.from("booking_payment_requests").update({
          status: "paid_conflict",
          failure_reason: "payment_reservation_missing",
          updated_at: new Date().toISOString(),
        }).eq("id", request.id).eq("studio_id", studio.id).neq("status", "converted");
        if (markError) throw markError;
        await notifyPaidBookingRequiresReview(sb, {
          studioId: studio.id,
          bookingRequestId: request.id,
          paymentId: pi.id,
        });
      }
    }
    throw new Error("payment_reservation_missing");
  }
  assertDirectChargeAccount(reservedPayment.stripe_connect_account_id, stripeAccount);
  assertBookingPaymentMatchesStripe(reservedPayment, pi);

  const resolvedStatus = resolveBookingPaymentStatus(reservedPayment.status, piStatus);
  if (resolvedStatus !== piStatus) {
    console.info("[payments-webhook] out_of_order_state_ignored", {
      stripe_payment_intent_id: pi.id,
      current_status: reservedPayment.status,
      incoming_status: piStatus,
    });
    return;
  }

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
    stripe_connect_account_id: stripeAccount,
    status: piStatus,
    ...financialPatch,
    updated_at: new Date().toISOString(),
  };

  let paymentUpdate = sb
    .from("payment_intents")
    .update(paymentPatch)
    .eq("id", reservedPayment.id)
    .eq("studio_id", reservedPayment.studio_id);
  if (kind !== "succeeded") paymentUpdate = paymentUpdate.neq("status", "succeeded");
  const { data: updatedByStripeId, error: updateError } = await paymentUpdate.select("id");
  if (updateError) throw updateError;

  let updatedFallback: Array<{ id: string }> = [];
  if ((!updatedByStripeId || updatedByStripeId.length === 0) && bookingRequestId) {
    let fallbackUpdate = sb
      .from("payment_intents")
      .update(paymentPatch)
      .eq("studio_id", reservedPayment.studio_id)
      .eq("booking_request_id", bookingRequestId)
      .is("stripe_payment_intent_id", null);
    if (kind !== "succeeded") fallbackUpdate = fallbackUpdate.neq("status", "succeeded");
    const fallbackResult = await fallbackUpdate.select("id");
    if (fallbackResult.error) throw fallbackResult.error;
    updatedFallback = fallbackResult.data ?? [];
  }

  if (
    kind !== "succeeded" &&
    (!updatedByStripeId || updatedByStripeId.length === 0) &&
    updatedFallback.length === 0
  ) {
    return;
  }

  if (kind === "succeeded") {
    if (bookingRequestId) {
      const { data: appointmentId, error } = await sb.rpc("confirm_paid_booking_request", {
        p_request_id: bookingRequestId,
        p_stripe_payment_intent_id: pi.id,
      });
      if (error) {
        const code = paidBookingRecoveryErrorCode(error);
        if (!isTerminalPaidBookingError(error)) throw new Error(code);
        const { error: markError } = await sb.from("booking_payment_requests").update({
          status: "paid_conflict",
          failure_reason: code,
          updated_at: new Date().toISOString(),
        }).eq("id", bookingRequestId).eq("studio_id", reservedPayment.studio_id)
          .neq("status", "converted");
        if (markError) throw markError;
        await notifyPaidBookingRequiresReview(sb, {
          studioId: reservedPayment.studio_id,
          bookingRequestId,
          paymentId: reservedPayment.id,
        });
        return;
      }
      if (!appointmentId) {
        await notifyPaidBookingRequiresReview(sb, {
          studioId: reservedPayment.studio_id,
          bookingRequestId,
          paymentId: reservedPayment.id,
        });
        console.warn("[payments-webhook] paid_booking_requires_manual_review", {
          booking_request_id: bookingRequestId,
          stripe_payment_intent_id: pi.id,
        });
        return;
      }
      // A previous delivery may have recorded the payment before its booking
      // RPC failed. Retry the idempotent confirmation message once the link exists.
      if (!reservedPayment.appointment_id) {
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

  if (stripeAccount) {
    // Connected-account Checkout events are never allowed to grant a Bellza plan.
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
    stripe_checkout_session_id: session.id,
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
  const planConfig = getPlanConfigFromSubscription(env, subscription);
  const stripePrice = subscription.items.data[0]?.price;
  const status = subscription.status ?? "incomplete";
  const periodEnd = getCurrentPeriodEnd(subscription);
  const currentPeriodEnd = periodEnd
    ? new Date(periodEnd * 1000).toISOString()
    : null;

  if (!userId) throw new Error("subscription_user_binding_invalid");
  if (!studioId) throw new Error("subscription_studio_binding_missing");
  if (!priceId || !planConfig || !stripePrice) {
    throw new Error("subscription_plan_binding_invalid");
  }
  if (!stripeRecurringPriceMatchesPlan(stripePrice, env, planConfig)) {
    throw new Error("subscription_price_contract_invalid");
  }

  const sb = getAdminClient();
  const { data: role, error: roleError } = await sb
    .from("user_roles")
    .select("studio_id,role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .in("role", ["studio_owner", "saas_owner"])
    .limit(1)
    .maybeSingle();
    
  if (roleError || !role?.studio_id) throw new Error("subscription_owner_binding_invalid");

  const { data: billingStudio, error: studioLookupError } = await sb
    .from("studios")
    .select("id,stripe_customer_id")
    .eq("id", studioId)
    .maybeSingle();
  if (
    studioLookupError ||
    !billingStudio?.id ||
    !customerId ||
    billingStudio.stripe_customer_id !== customerId
  ) throw new Error("subscription_customer_binding_invalid");

  const activeAccess = hasPeriodAccess(status, currentPeriodEnd);

  const subscriptionPatch = {
    user_id: userId,
    studio_id: studioId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    plan: planConfig.billingInterval,
    plan_tier: planConfig.tier,
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
    plan_tier: activeAccess ? planConfig.tier : "free",
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
  if (!subscription.id) return;
  const stripe = createStripeClient(env);
  const current = await stripe.subscriptions.retrieve(subscription.id);
  await syncSubscription(current, env);
}

async function handleCheckoutSessionExpired(session: StripePayload, stripeAccount?: string | null) {
  if (stripeAccount || isBookingCheckoutSession(session)) return;
  const studioId = session.metadata?.studio_id;
  const userId = session.metadata?.user_id;
  if (!studioId || !userId) return;

  const sb = getAdminClient();
  const { data: role } = await sb
    .from("user_roles")
    .select("studio_id")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .in("role", ["studio_owner", "saas_owner"])
    .limit(1)
    .maybeSingle();
  if (!role?.studio_id) return;

  await sb
    .from("subscriptions")
    .delete()
    .eq("studio_id", studioId)
    .eq("user_id", userId)
    .eq("status", "checkout_pending");
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

function stripeObjectId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

async function loadDirectChargePayment(input: {
  paymentIntentId?: string | null;
  chargeId?: string | null;
  stripeAccount?: string | null;
}) {
  const sb = getAdminClient();
  const select =
    "id,studio_id,amount_cents,currency,status,stripe_payment_intent_id,stripe_charge_id,stripe_connect_account_id";
  let row: any = null;

  if (input.paymentIntentId) {
    const result = await (sb as any)
      .from("payment_intents")
      .select(select)
      .eq("stripe_payment_intent_id", input.paymentIntentId)
      .maybeSingle();
    if (result.error) throw result.error;
    row = result.data;
  }
  if (!row?.id && input.chargeId) {
    const result = await (sb as any)
      .from("payment_intents")
      .select(select)
      .eq("stripe_charge_id", input.chargeId)
      .maybeSingle();
    if (result.error) throw result.error;
    row = result.data;
  }

  if (!row?.id) throw new Error("direct_charge_payment_not_found");
  assertDirectChargeAccount(row.stripe_connect_account_id, input.stripeAccount);
  return row;
}

async function syncChargeRefundState(
  charge: StripePayload,
  stripeAccount?: string | null,
) {
  const paymentIntentId = stripeObjectId(charge.payment_intent);
  const row = await loadDirectChargePayment({
    paymentIntentId,
    chargeId: charge.id ?? null,
    stripeAccount,
  });
  const amountRefunded = Number(charge.amount_refunded ?? 0);
  const originalAmount = Number(row.amount_cents || 0);
  if (!Number.isInteger(amountRefunded) || amountRefunded < 0 || amountRefunded > originalAmount) {
    throw new Error("refund_amount_mismatch");
  }

  // The production schema records exact refund amounts in financial_audit_logs
  // and the final request state in refund_requests; it has no per-payment
  // refund summary columns. Keep the Stripe amount validation fail-closed.
  return row;
}

async function handleRefundEvent(
  webhookRefund: StripePayload,
  stripeAccount: string | null | undefined,
  env: StripeEnv,
) {
  if (!webhookRefund.id) throw new Error("refund_id_missing");
  if (!stripeAccount) throw new Error("connect_event_account_missing");
  const stripe = createStripeClient(env);
  // Fetch current Stripe state so a delayed refund.created event cannot
  // overwrite a later succeeded/failed refund.updated event.
  const refund = (await stripe.refunds.retrieve(
    webhookRefund.id,
    {},
    { stripeAccount },
  )) as unknown as StripePayload;
  const paymentIntentId = stripeObjectId(refund.payment_intent);
  const chargeId = stripeObjectId(refund.charge);
  const row = await loadDirectChargePayment({ paymentIntentId, chargeId, stripeAccount });
  const resolvedChargeId = chargeId ?? row.stripe_charge_id;
  if (!resolvedChargeId) throw new Error("refund_charge_missing");
  const charge = await stripe.charges.retrieve(
    resolvedChargeId,
    {},
    { stripeAccount: stripeAccount as string },
  );
  await syncChargeRefundState(charge as unknown as StripePayload, stripeAccount);

  const refundStatus = String(refund.status ?? "pending");
  const refundRequestId = refund.metadata?.refund_request_id ?? null;
  const refundPatch: Record<string, unknown> = {
    stripe_refund_id: refund.id,
    refund_method: "stripe_connect_direct_charge",
    updated_at: new Date().toISOString(),
  };
  if (refundStatus === "succeeded") {
    refundPatch.status = "refunded";
    refundPatch.platform_processed_at = new Date().toISOString();
  }

  let requestUpdate = (getAdminClient() as any)
    .from("refund_requests")
    .update(refundPatch)
    .eq("studio_id", row.studio_id);
  requestUpdate = refundRequestId
    ? requestUpdate.eq("id", refundRequestId)
    : requestUpdate.eq("stripe_refund_id", refund.id);
  const { error: requestError } = await requestUpdate;
  if (requestError) throw requestError;

  await (getAdminClient() as any).from("financial_audit_logs").insert({
    studio_id: row.studio_id,
    entity_type: refundRequestId ? "refund_request" : "payment_intent",
    entity_id: refundRequestId ?? row.id,
    action: `stripe_refund_${refundStatus}`,
    amount_cents: Number(refund.amount || 0),
    currency: row.currency || "eur",
    metadata: { stripe_refund_id: refund.id, stripe_refund_status: refundStatus },
  });
}

async function handleDisputeEvent(
  webhookDispute: StripePayload,
  stripeAccount: string | null | undefined,
  env: StripeEnv,
) {
  if (!webhookDispute.id) throw new Error("dispute_id_missing");
  if (!stripeAccount) throw new Error("connect_event_account_missing");
  const stripe = createStripeClient(env);
  // Fetch current Stripe state so delayed events cannot regress a dispute.
  const dispute = (await stripe.disputes.retrieve(
    webhookDispute.id,
    {},
    { stripeAccount },
  )) as unknown as StripePayload;
  const paymentIntentId = stripeObjectId(dispute.payment_intent);
  const chargeId = stripeObjectId(dispute.charge);
  const row = await loadDirectChargePayment({ paymentIntentId, chargeId, stripeAccount });
  const amount = Number(dispute.amount || 0);
  if (!Number.isInteger(amount) || amount <= 0 || amount > Number(row.amount_cents || 0)) {
    throw new Error("dispute_amount_mismatch");
  }
  const status = String(dispute.status ?? "unknown");
  // The current schema has no dispute columns on payment_intents. Preserve the
  // exact Stripe state and amount in the existing immutable audit log instead.
  await (getAdminClient() as any).from("financial_audit_logs").insert({
    studio_id: row.studio_id,
    entity_type: "payment_intent",
    entity_id: row.id,
    action: `stripe_dispute_${status}`,
    amount_cents: amount,
    currency: row.currency || "eur",
    metadata: { stripe_dispute_id: dispute.id },
  });
}

async function syncWithdrawalRequest(
  obj: StripePayload,
  status: "processing" | "completed" | "failed" | "canceled",
  eventConnectAccountId?: string | null,
) {
  const requestId = obj.metadata?.withdrawal_request_id;
  if (!requestId) return;

  const sb = getAdminClient();
  const { data: request, error: requestError } = await sb
    .from("withdrawal_requests")
    .select("id,studio_id,status,payout_method,payout_mode,stripe_account_id,stripe_transfer_id")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request) throw new Error("withdrawal_request_not_found");
  const { data: studio, error: studioError } = await sb
    .from("studios")
    .select("stripe_connect_account_id")
    .eq("id", request.studio_id)
    .maybeSingle();
  if (studioError) throw studioError;
  assertWithdrawalWebhookBinding({
    requestId: request.id,
    metadataRequestId: requestId,
    studioId: request.studio_id,
    metadataStudioId: obj.metadata?.studio_id,
    expectedConnectAccountId: request.stripe_account_id,
    studioConnectAccountId: studio?.stripe_connect_account_id,
    eventConnectAccountId,
    expectedStripeObjectId: request.stripe_transfer_id,
    eventStripeObjectId: obj.id,
    payoutMethod: request.payout_method,
    payoutMode: request.payout_mode,
  });
  if (request.status === status || (status === "processing" &&
    ["completed", "paid", "failed", "canceled", "rejected"].includes(request.status))) return;
  if (["completed", "paid", "failed", "canceled", "rejected"].includes(request.status)) {
    throw new Error("withdrawal_terminal_state_conflict");
  }

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

  const { data: updated, error } = await sb
    .from("withdrawal_requests")
    .update(patch)
    .eq("id", requestId)
    .eq("studio_id", request.studio_id)
    .eq("stripe_account_id", request.stripe_account_id)
    .eq("stripe_transfer_id", request.stripe_transfer_id)
    .eq("status", request.status)
    .select("id");
  if (error) throw error;
  if (updated?.length !== 1) throw new Error("withdrawal_state_changed");
}

type BillingEventClaim = { claimed: false } | { claimed: true; token: string };

async function claimBillingEvent(event: {
  id?: string;
  type: string;
  created?: number;
  livemode?: boolean;
  account?: string;
  data: { object: StripePayload };
}) {
  if (!event.id) throw new Error("stripe_webhook_event_id_missing");
  const obj = event.data.object;
  const studioId = obj.metadata?.studio_id;
  const sb = getAdminClient();
  const { data, error } = await (sb as any).rpc("claim_stripe_webhook_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_studio_id: studioId ?? null,
    p_payload: minimalStripeEventAudit(event as any),
    p_lease_seconds: 120,
  });
  if (error) throw error;
  const state = data?.state;
  if (state === "processed") return { claimed: false } satisfies BillingEventClaim;
  if (state === "busy") throw new Error("stripe_webhook_event_in_progress");
  if (state !== "claimed" || typeof data?.token !== "string" || !data.token) {
    throw new Error("stripe_webhook_claim_invalid_state");
  }
  return { claimed: true, token: data.token } satisfies BillingEventClaim;
}

async function completeBillingEventClaim(eventId: string | undefined, processingToken: string) {
  if (!eventId) throw new Error("stripe_webhook_event_id_missing");
  const sb = getAdminClient();
  const { data, error } = await (sb as any).rpc("complete_stripe_webhook_event", {
    p_event_id: eventId,
    p_processing_token: processingToken,
  });
  if (error) throw error;
  if (data !== true) throw new Error("stripe_webhook_completion_stale_claim");
}

async function failBillingEventClaim(
  eventId: string | undefined,
  processingToken: string,
  error: unknown,
) {
  if (!eventId) return;
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "stripe_webhook_processing_failed";
  const sb = getAdminClient();
  const { error: updateError } = await (sb as any).rpc("fail_stripe_webhook_event", {
    p_event_id: eventId,
    p_processing_token: processingToken,
    p_error: message,
  });
  if (updateError) {
    console.error("[stripe-webhook] event_failure_state_update_failed", {
      eventId,
      reason: updateError.message,
    });
  }
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
  const claim = await claimBillingEvent(event);
  if (!claim.claimed) {
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
          const inPersonMbWay = await handleInPersonMbWayPaymentIntent(obj, "succeeded", event.account);
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
          const inPersonMbWay = await handleInPersonMbWayPaymentIntent(obj, "processing", event.account);
          if (inPersonMbWay.handled) break;
        }
        await handlePaymentIntent(obj, "processing", event.account ?? null, env);
        break;
      case "payment_intent.payment_failed":
        {
          const inPersonMbWay = await handleInPersonMbWayPaymentIntent(obj, "failed", event.account);
          if (inPersonMbWay.handled) break;
        }
        await handlePaymentIntent(obj, "failed", event.account ?? null, env);
        break;
      case "payment_intent.canceled":
        {
          const inPersonMbWay = await handleInPersonMbWayPaymentIntent(obj, "canceled", event.account);
          if (inPersonMbWay.handled) break;
        }
        await handlePaymentIntent(obj, "canceled", event.account ?? null, env);
        break;
      case "checkout.session.completed":
        await handleCheckoutSession(obj, env, event.account ?? null);
        break;
      case "checkout.session.expired":
        await handleCheckoutSessionExpired(obj, event.account ?? null);
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
        if (!event.account) await handleInvoice(obj, env);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        if (!event.account) await handleSubscription(obj, env);
        break;
      case "charge.refunded":
        if (event.account) await syncChargeRefundState(obj, event.account);
        break;
      case "refund.created":
      case "refund.updated":
      case "refund.failed":
        if (event.account) await handleRefundEvent(obj, event.account, env);
        break;
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated":
        if (event.account) await handleDisputeEvent(obj, event.account, env);
        break;
      case "transfer.created":
      case "payout.created":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        await syncWithdrawalRequest(obj, "processing", event.account);
        break;
      case "transfer.paid":
      case "payout.paid":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        await syncWithdrawalRequest(obj, "completed", event.account);
        break;
      case "transfer.failed":
      case "payout.failed":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        await syncWithdrawalRequest(obj, "failed", event.account);
        break;
      case "payout.canceled":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        await syncWithdrawalRequest(obj, "canceled", event.account);
        break;
      case "balance.available":
      case "account.updated":
        if (event.account) await syncConnectAccountFromWebhook(event.account);
        else if (typeof obj.id === "string" && obj.id.startsWith("acct_")) await syncConnectAccountFromWebhook(obj.id);
        break;
      default:
        break;
    }
    await completeBillingEventClaim(event.id, claim.token);
    console.info("[stripe-webhook] event_processed", {
      eventId: event.id ?? null,
      type: event.type,
    });
  } catch (error) {
    await failBillingEventClaim(event.id, claim.token, error);
    throw error;
  }
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = (await verifyWebhook(req, env)) as {
    id?: string;
    type: string;
    created?: number;
    livemode?: boolean;
    account?: string;
    data: { object: StripePayload };
  };
  await processWebhookEvent(event, env);
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        try {
          const env = getConfiguredStripeEnv();
          assertStripeRuntimeConfig(env);
          // The query string may only confirm the server-selected environment;
          // it can never switch a Worker between sandbox and live.
          if (rawEnv && rawEnv !== env) throw new Error("stripe_webhook_environment_mismatch");
          await handleWebhook(request, env);
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
