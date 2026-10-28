import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createStripeClient, getConfiguredStripeEnv, resolveStripeAppBaseUrl, type StripeEnv } from "@/lib/stripe.server";
import { assertConnectedAccountReadyForCharge } from "@/lib/stripe-connect-integrity.server";
import { assertExactStripeAmount } from "@/lib/stripe-financial-integrity";
import {
  minimumStripeCheckoutAmountCents,
  type CheckoutPaymentMethod,
} from "@/lib/payment-amount";
import { calculateDepositCharge, readDepositSnapshot, type DepositRule } from "@/lib/deposit-rule";
import { sendAppointmentConfirmationMessage } from "@/lib/whatsapp.functions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertStudioAccess,
  assertStudioEntitlement,
  getRequestFingerprint,
  rateLimitOrThrow,
} from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { isTerminalPaidBookingError, paidBookingCheckpointErrorCode, paidBookingRecoveryErrorCode } from "@/lib/paid-booking-recovery-state";

const PAYMENT_METHOD_MESSAGES: Record<string, string> = {
  connect_not_ready:
    "Este estúdio ainda não configurou os pagamentos online. Entre em contacto com o estúdio para concluir a reserva.",
  mb_way_unavailable:
    "MB WAY não está disponível nesta configuração. Escolha outro método ou contacte o estúdio.",
  mb_way_connect_not_ready:
    "MB WAY ainda não está ativo na conta Stripe deste estúdio. Escolha cartão ou contacte o estúdio.",
  card_unavailable:
    "Cartão não está disponível nesta configuração. Escolha outro método ou contacte o estúdio.",
  mb_way_phone_invalid:
    "MB WAY exige um telemóvel português válido. Verifique o número e recomece a reserva.",
  payment_method_unavailable:
    "Este método de pagamento não está disponível de momento. Escolha outro método.",
};

function admin(): any {
  return getAdminClient();
}

function stripeEnv(): StripeEnv {
  return getConfiguredStripeEnv();
}

function appBaseUrl() {
  return resolveStripeAppBaseUrl({ request: getRequest() });
}

const CreateIntentInput = z
  .object({
    appointmentId: z.string().uuid().optional(),
    bookingRequestId: z.string().uuid().optional(),
    method: z.enum(["mb_way", "card"]),
  })
  .refine((v) => v.appointmentId || v.bookingRequestId, {
    message: "booking_request_required",
  });

const ReconcileStudioInput = z.object({
  studioId: z.string().uuid(),
});

async function confirmBookingRequest(sb: any, requestId: string, stripePaymentIntentId: string) {
  const stripe = createStripeClient(stripeEnv());
  const reservation = await loadPaymentReservationForConfirmation(sb, requestId, stripePaymentIntentId);
  const stripeAccount = reservation.stripe_connect_account_id as string | null | undefined;
  const fresh = await stripe.paymentIntents.retrieve(
    stripePaymentIntentId,
    undefined,
    stripeAccount ? { stripeAccount } : undefined,
  );
  const freshStatus = normalizeStripeStatus(fresh.status);
  if (freshStatus !== "succeeded") {
    await sb
      .from("payment_intents")
      .update({
        status: freshStatus,
        failure_reason: fresh.status === "requires_payment_method" ? "payment_failed" : null,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_payment_intent_id", stripePaymentIntentId);
    throw new Error("payment_not_confirmed");
  }
  assertStripePaymentMatchesReservation(reservation, fresh);
  const { data: previous } = await sb
    .from("payment_intents")
    .select("status,appointment_id")
    .eq("stripe_payment_intent_id", stripePaymentIntentId)
    .maybeSingle();
  await sb
    .from("payment_intents")
    .update({ status: "succeeded", updated_at: new Date().toISOString() })
    .eq("stripe_payment_intent_id", stripePaymentIntentId);
  const { data, error } = await sb.rpc("confirm_paid_booking_request", {
    p_request_id: requestId,
    p_stripe_payment_intent_id: stripePaymentIntentId,
  });
  if (error) {
    throw new Error(paidBookingRecoveryErrorCode(error));
  }
  if (!data) throw new Error("paid_booking_requires_manual_review");
  if (previous?.status !== "succeeded" || !previous?.appointment_id) {
    await sendAppointmentConfirmationMessage(sb, { stripePaymentIntentId }).catch((sendError) => {
      console.error("senddm whatsapp confirmation failed", sendError);
    });
  }
  return data as string;
}

async function loadPaymentReservationForConfirmation(
  sb: any,
  requestId: string,
  stripePaymentIntentId: string,
) {
  const { data, error } = await sb
    .from("payment_intents")
    .select("id,studio_id,booking_request_id,amount_cents,currency,status,stripe_payment_intent_id,stripe_connect_account_id,booking_payment_requests:booking_request_id(id,studio_id,status,client_phone)")
    .eq("booking_request_id", requestId)
    .eq("stripe_payment_intent_id", stripePaymentIntentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("payment_reservation_missing");
  return data;
}

function assertStripePaymentMatchesReservation(row: any, paymentIntent: any) {
  const metadata = paymentIntent.metadata ?? {};
  const expectedAmount = Number(row.amount_cents || 0);
  assertExactStripeAmount({
    expectedAmountCents: expectedAmount,
    stripeAmountCents: Number(paymentIntent.amount || 0),
    receivedAmountCents: Number(paymentIntent.amount_received || 0),
    succeeded: paymentIntent.status === "succeeded",
  });
  if ((row.currency || "eur").toLowerCase() !== (paymentIntent.currency || "eur").toLowerCase()) {
    throw new Error("payment_currency_mismatch");
  }
  if (metadata.studio_id !== row.studio_id) {
    throw new Error("payment_studio_mismatch");
  }
  if (row.booking_request_id && metadata.booking_request_id !== row.booking_request_id) {
    throw new Error("payment_booking_mismatch");
  }
  const request = Array.isArray(row.booking_payment_requests)
    ? row.booking_payment_requests[0] : row.booking_payment_requests;
  if (row.booking_request_id && metadata.client_phone && request?.client_phone &&
      (normalizePortugueseMobile(metadata.client_phone) ?? metadata.client_phone.replace(/\s/g, "")) !==
      (normalizePortugueseMobile(request.client_phone) ?? request.client_phone.replace(/\s/g, ""))) {
    throw new Error("payment_client_phone_mismatch");
  }
  if (row.appointment_id && metadata.appointment_id !== row.appointment_id && !row.booking_request_id) {
    throw new Error("payment_appointment_mismatch");
  }
}

async function expireStaleReservations(sb: any) {
  try {
    const { error } = await sb.rpc("expire_pending_appointments");
    if (error) console.error("expire_pending_appointments_failed", error);
  } catch (error) {
    console.error("expire_pending_appointments_failed", error);
  }
}

async function failBookingRequest(
  sb: any,
  bookingRequestId: string | null,
  reason: string,
  stripePaymentIntentId?: string | null,
) {
  if (bookingRequestId) {
    await sb
      .from("booking_payment_requests")
      .update({
        status: "failed",
        failure_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingRequestId)
      .in("status", ["awaiting_payment", "processing"]);
  }
  if (stripePaymentIntentId) {
    await sb
      .from("payment_intents")
      .update({
        status: "failed",
        failure_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_payment_intent_id", stripePaymentIntentId);
  }
}

function extractCheckoutSessionId(value: string | null | undefined) {
  if (!value) return null;
  return value.match(/cs_(?:test|live)_[A-Za-z0-9]+/)?.[0] ?? null;
}

async function selectPaymentIntentById(sb: any, id: string) {
  const { data } = await sb
    .from("payment_intents")
    .select(
      "id, studio_id, status, stripe_payment_intent_id, stripe_checkout_session_id, stripe_connect_account_id, client_secret, hosted_voucher_url, expires_at, method, appointment_id, booking_request_id, amount_cents, currency",
    )
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function reconcileCheckoutSessionPayment(
  sb: any, row: any, options: { dispatchPush?: boolean } = {},
) {
  if (!row || (row.status === "succeeded" && row.appointment_id)) return row;

  const checkoutSessionId =
    row.stripe_checkout_session_id ?? extractCheckoutSessionId(row.hosted_voucher_url);
  if (!checkoutSessionId) return row;

  const stripe = createStripeClient(stripeEnv());
  const stripeAccount = row.stripe_connect_account_id as string | null | undefined;
  const session = await stripe.checkout.sessions.retrieve(
    checkoutSessionId,
    { expand: ["payment_intent"] },
    stripeAccount ? { stripeAccount } : undefined,
  );
  const paymentIntent =
    typeof session.payment_intent === "object" && session.payment_intent
      ? session.payment_intent
      : null;
  const stripePaymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : paymentIntent?.id ?? null;

  if (!stripePaymentIntentId) {
    return row;
  }
  if (row.stripe_payment_intent_id && row.stripe_payment_intent_id !== stripePaymentIntentId) {
    throw new Error("checkout_payment_intent_mismatch");
  }

  const freshPaymentIntent = paymentIntent ?? await stripe.paymentIntents.retrieve(
    stripePaymentIntentId,
    undefined,
    stripeAccount ? { stripeAccount } : undefined,
  );
  if (freshPaymentIntent.status === "succeeded") {
    assertStripePaymentMatchesReservation(row, freshPaymentIntent);
  }

  const freshStatus = normalizeStripeStatus(freshPaymentIntent.status);
  if (row.status === "succeeded" && freshStatus !== "succeeded") {
    throw new Error("payment_state_disagreement_requires_manual_review");
  }
  if (freshStatus !== "succeeded" && row.status === "expired") return row;
  const patch: Record<string, unknown> = {
    stripe_checkout_session_id: checkoutSessionId,
    stripe_payment_intent_id: stripePaymentIntentId ?? row.stripe_payment_intent_id,
    client_secret: freshPaymentIntent.client_secret ?? row.client_secret ?? null,
    status: freshStatus,
    failure_reason:
      freshStatus === "failed"
        ? freshPaymentIntent.last_payment_error?.message ?? "payment_failed"
        : null,
    updated_at: new Date().toISOString(),
  };

  const { error: paymentUpdateError } = await sb.from("payment_intents")
    .update(patch).eq("id", row.id).eq("studio_id", row.studio_id);
  if (paymentUpdateError) throw paymentUpdateError;

  if (freshStatus === "succeeded" && stripePaymentIntentId) {
    if (row.booking_request_id) {
      try {
        await confirmBookingRequest(sb, row.booking_request_id, stripePaymentIntentId);
      } catch (error) {
        if (!isTerminalPaidBookingError(error)) throw error;
        const { error: markError } = await sb.from("booking_payment_requests").update({
          status: "paid_conflict",
          failure_reason: paidBookingRecoveryErrorCode(error),
          updated_at: new Date().toISOString(),
        }).eq("id", row.booking_request_id).eq("studio_id", row.studio_id)
          .neq("status", "converted");
        if (markError) throw markError;
        await (await import("@/lib/paid-booking-alert.server")).notifyPaidBookingRequiresReview(sb, {
          studioId: row.studio_id,
          bookingRequestId: row.booking_request_id,
          paymentId: row.id,
        }, { dispatchPush: options.dispatchPush });
      }
    } else if (row.appointment_id) {
      await sb
        .from("appointments")
        .update({ status: "confirmed", updated_at: new Date().toISOString() })
        .eq("id", row.appointment_id)
        .eq("status", "pending_payment");
    }
  }

  if (freshStatus === "failed" || freshStatus === "canceled") {
    await failBookingRequest(
      sb,
      row.booking_request_id ?? null,
      "payment_failed",
      stripePaymentIntentId,
    );
  }

  return (await selectPaymentIntentById(sb, row.id)) ?? { ...row, ...patch };
}

/** Recheck existing Checkout sessions only. This path never creates a payment. */
export async function reconcileUnlinkedBookingPayments() {
  const sb = admin();
  const dueBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  // Keep the original 30-day launch cohort fixed. A rolling cutoff can silently
  // drop an unpaid-looking row before a later cron execution reaches it.
  const cohortStart = "2026-09-15T18:00:00.000Z";
  // Alternate fresh rows and the oldest due retries. Otherwise a sustained
  // influx of fresh rows can starve a payment whose previous attempt failed.
  const freshFirst = Math.floor(Date.now() / (10 * 60_000)) % 2 === 0;
  // These paid past-slot exceptions require separate manual resolution. None
  // may consume this bounded automatic batch or be replayed by this cron.
  const manualReviewExcludedRequests = new Set([
    "9f52851f-6dc9-407a-ac39-fa4e389822f1",
    "ef05bcd8-8753-4de8-a51a-3c81d951dc76",
    "ec9a4dfe-f559-4273-a81a-316c6537b40d",
  ]);
  const select = "id,studio_id,status,stripe_payment_intent_id,stripe_checkout_session_id,stripe_connect_account_id,client_secret,hosted_voucher_url,expires_at,method,appointment_id,booking_request_id,amount_cents,currency,booking_payment_requests:booking_request_id(status)";
  const base = () => sb.from("payment_intents").select(select)
    .not("booking_request_id", "is", null)
    .not("booking_request_id", "in", `(${[...manualReviewExcludedRequests].join(",")})`)
    .not("stripe_checkout_session_id", "is", null)
    .gte("created_at", cohortStart)
    .or(`booking_reconciled_at.is.null,booking_reconciled_at.lt.${dueBefore}`)
    .order("booking_reconciled_at", { ascending: true, nullsFirst: freshFirst })
    .order("created_at", { ascending: true })
    .limit(1);
  const [unsettled, unlinked] = await Promise.all([
    base().in("status", ["requires_action", "processing", "expired", "failed"]),
    base().eq("status", "succeeded").is("appointment_id", null),
  ]);
  if (unsettled.error) throw unsettled.error;
  if (unlinked.error) throw unlinked.error;
  // One paid confirmation may consume this run. Rotate category order so a
  // constant stream of newly settled sessions cannot starve either group.
  const rows = freshFirst
    ? [...(unsettled.data ?? []), ...(unlinked.data ?? [])]
    : [...(unlinked.data ?? []), ...(unsettled.data ?? [])];
  let repaired = 0;
  let manual = 0;
  let failures = 0;
  let checked = 0;
  for (const row of rows) {
    if (manualReviewExcludedRequests.has(row.booking_request_id)) continue;
    checked += 1;
    let errorCode: string | null = null;
    let rowFailed = false;
    let checkpointFailed = false;
    let paidHandled = false;
    try {
      const request = Array.isArray(row.booking_payment_requests)
        ? row.booking_payment_requests[0] : row.booking_payment_requests;
      if (request?.status === "paid_conflict") {
        manual += 1;
        await (await import("@/lib/paid-booking-alert.server")).notifyPaidBookingRequiresReview(sb, {
          studioId: row.studio_id,
          bookingRequestId: row.booking_request_id,
          paymentId: row.id,
        }, { dispatchPush: false });
      } else {
        const result = await reconcileCheckoutSessionPayment(sb, row, { dispatchPush: false });
        paidHandled = result?.status === "succeeded";
        if (result?.appointment_id && !row.appointment_id) repaired += 1;
      }
    } catch (error) {
      failures += 1;
      rowFailed = true;
      errorCode = paidBookingRecoveryErrorCode(error);
      console.error("booking_payment_reconciliation_failed", {
        payment_id: row.id,
        studio_id: row.studio_id,
        code: errorCode,
      });
      try {
        const { error: firstFailureError } = await sb.from("payment_intents")
          .update({ booking_reconciliation_first_failed_at: new Date().toISOString() })
          .eq("id", row.id).eq("studio_id", row.studio_id)
          .is("booking_reconciliation_first_failed_at", null);
        if (firstFailureError) throw firstFailureError;
      } catch (checkpointError) {
        checkpointFailed = true;
        console.error("booking_reconciliation_first_failure_checkpoint_failed", {
          payment_id: row.id,
          code: paidBookingCheckpointErrorCode(checkpointError),
        });
      }
    } finally {
      const checkpoint: Record<string, unknown> = {
        booking_reconciled_at: new Date().toISOString(),
        booking_reconciliation_error_code: errorCode,
      };
      if (!errorCode) checkpoint.booking_reconciliation_first_failed_at = null;
      try {
        const { error } = await sb.from("payment_intents")
          .update(checkpoint)
          .eq("id", row.id).eq("studio_id", row.studio_id);
        if (error) throw error;
      } catch (checkpointError) {
        checkpointFailed = true;
        console.error("booking_payment_reconciliation_checkpoint_failed", {
          payment_id: row.id,
          code: paidBookingCheckpointErrorCode(checkpointError),
        });
      }
    }
    if (checkpointFailed) {
      if (!rowFailed) failures += 1;
      break;
    }
    // Paid confirmation can also send the existing WhatsApp/email messages.
    // Keep that potentially expensive path to one payment per Free-plan run.
    if (paidHandled) break;
  }
  console.info("booking_payment_reconciliation_complete", { checked, repaired, manual, failures });
  return { checked, repaired, manual, failures };
}

export const createBookingPaymentIntent = createServerFn({ method: "POST" })
  .inputValidator((input) => CreateIntentInput.parse(input))
  .handler(async ({ data }) => {
    const sb = admin();
    await expireStaleReservations(sb);

    const bookingRequestId = data.bookingRequestId ?? null;
    const appointmentId = data.appointmentId ?? null;
    await rateLimitOrThrow({
      key: `payment-create:${bookingRequestId ?? appointmentId}:${getRequestFingerprint()}`,
      limit: 8,
      windowMs: 10 * 60 * 1000,
    });

    const existingQuery = sb
      .from("payment_intents")
      .select(
        "id, studio_id, stripe_payment_intent_id, stripe_checkout_session_id, stripe_connect_account_id, client_secret, amount_cents, currency, method, status, hosted_voucher_url, expires_at, appointment_id, booking_request_id",
      )
      .order("created_at", { ascending: false })
      .limit(1);

    const { data: existing } = bookingRequestId
      ? await existingQuery
          .eq("booking_request_id", bookingRequestId)
          .in("status", ["requires_action", "processing", "succeeded"])
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .maybeSingle()
      : await existingQuery
          .eq("appointment_id", appointmentId)
          .in("status", ["requires_action", "processing", "succeeded"])
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .maybeSingle();

    if (existing) {
      const reconciledExisting = await reconcileCheckoutSessionPayment(sb, existing);
      const source = await loadPaymentSource(sb, bookingRequestId, appointmentId);
      await assertStudioEntitlement(sb, source.studioId, "online_payments");
      assertCheckoutAmountSupported(Number(reconciledExisting.amount_cents), source.currency, reconciledExisting.method);
      return {
        ...formatIntentResponse(reconciledExisting, source.totalCents, source.depositRule),
        mb_way_phone:
          reconciledExisting.method === "mb_way" ? normalizePortugueseMobile(source.clientPhone) : null,
        checkout_url: reconciledExisting.hosted_voucher_url,
      };
    }

    const source = await loadPaymentSource(sb, bookingRequestId, appointmentId);
    await assertStudioEntitlement(sb, source.studioId, "online_payments");
    const accepted = source.acceptedMethods;
    if (!accepted.includes(data.method)) throw new Error("payment_method_not_accepted");

    const totalCents = source.totalCents;
    const amountCents = source.amountCents;
    assertCheckoutAmountSupported(amountCents, source.currency, data.method);

    // Stripe Connect guard — studio must have an active Connect account to receive deposits
    if (!source.connectAccountId || !source.connectChargesEnabled || !source.connectOnboardingCompleted) {
      throw new Error(PAYMENT_METHOD_MESSAGES.connect_not_ready);
    }
    if (data.method === "mb_way" && !source.connectMbWayPaymentsEnabled) {
      throw new Error(PAYMENT_METHOD_MESSAGES.mb_way_connect_not_ready);
    }

    const paymentMethodType = data.method === "mb_way" ? "mb_way" : "card";
    const billingPhone =
      data.method === "mb_way" ? normalizePortugueseMobile(source.clientPhone) : source.clientPhone;
    if (data.method === "mb_way" && !billingPhone) {
      throw new Error(PAYMENT_METHOD_MESSAGES.mb_way_phone_invalid);
    }

    const stripe = createStripeClient(stripeEnv());
    await assertConnectedAccountReadyForCharge(stripe, {
      accountId: source.connectAccountId,
      studioId: source.studioId,
      method: data.method,
      requirePayouts: true,
    });
    const checkoutExpiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
    const paymentMetadata = {
      ...(bookingRequestId ? { booking_request_id: bookingRequestId } : {}),
      ...(appointmentId ? { appointment_id: appointmentId } : {}),
      studio_id: source.studioId,
      client_phone: billingPhone || source.clientPhone,
      payment_kind: "booking_deposit",
      method: data.method,
    };
    const checkoutSessionPayload = {
      mode: "payment" as const,
      payment_method_types: [paymentMethodType],
      customer_email: source.clientEmail || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: source.currency,
            unit_amount: amountCents,
            product_data: {
              name: source.isFullPayment
                ? `Pagamento integral - ${source.studioName}`
                : `Sinal de reserva - ${source.studioName}`,
              description: new Date(source.startsAt).toLocaleString("pt-PT", {
                timeZone: source.studioTimezone,
              }),
            },
          },
        },
      ],
      metadata: {
        ...(bookingRequestId ? { booking_request_id: bookingRequestId } : {}),
        ...(appointmentId ? { appointment_id: appointmentId } : {}),
        studio_id: source.studioId,
        payment_kind: "booking_deposit",
        method: data.method,
      },
      payment_intent_data: {
        metadata: paymentMetadata,
      },
      success_url: `${appBaseUrl()}/s/${source.studioSlug}?payment=success`,
      cancel_url: `${appBaseUrl()}/s/${source.studioSlug}?payment=cancelled`,
      expires_at: checkoutExpiresAt,
      expand: ["payment_intent"],
    } satisfies Parameters<typeof stripe.checkout.sessions.create>[0];
    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.create(
        checkoutSessionPayload,
        {
          stripeAccount: source.connectAccountId,
          idempotencyKey: `booking-direct:${source.connectAccountId}:${bookingRequestId ?? appointmentId}:${amountCents}:${data.method}`,
        },
      );
    } catch (error) {
      const reason = stripePaymentFailureReason(error, data.method);
      console.error("stripe_booking_checkout_failed", {
        method: data.method,
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        PAYMENT_METHOD_MESSAGES[reason] ?? PAYMENT_METHOD_MESSAGES.payment_method_unavailable,
      );
    }
    const checkoutPaymentIntent =
      typeof checkoutSession.payment_intent === "object" ? checkoutSession.payment_intent : null;
    const expiresAt = checkoutSession.expires_at
      ? new Date(checkoutSession.expires_at * 1000).toISOString()
      : new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const paymentUrl = checkoutSession.url ?? null;

    const { data: checkoutRow, error: checkoutInsertError } = await sb
      .from("payment_intents")
      .insert({
        studio_id: source.studioId,
        appointment_id: appointmentId,
        booking_request_id: bookingRequestId,
        stripe_checkout_session_id: checkoutSession.id,
        stripe_payment_intent_id: checkoutPaymentIntent?.id ?? null,
        stripe_connect_account_id: source.connectAccountId,
        client_secret: checkoutPaymentIntent?.client_secret ?? null,
        amount_cents: amountCents,
        currency: source.currency,
        method: data.method,
        status: normalizeStripeStatus(checkoutPaymentIntent?.status ?? "requires_action"),
        hosted_voucher_url: paymentUrl,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (checkoutInsertError) throw new Error(checkoutInsertError.message);

    if (bookingRequestId) {
      const { data: activeRequest, error: requestUpdateError } = await sb
        .from("booking_payment_requests")
        .update({
          status: "processing",
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingRequestId)
        .in("status", ["awaiting_payment", "processing"])
        .select("id")
        .maybeSingle();
      if (requestUpdateError || !activeRequest?.id) {
        await stripe.checkout.sessions.expire(
          checkoutSession.id, {}, { stripeAccount: source.connectAccountId },
        ).catch(() => undefined);
        await sb.from("payment_intents")
          .update({ status: "expired", failure_reason: "booking_request_released" })
          .eq("id", checkoutRow.id)
          .in("status", ["requires_action", "processing"]);
        throw new Error("A reserva já não está disponível. Escolha outro horário.");
      }
    }

    return {
      ...formatIntentResponse(checkoutRow, totalCents, source.depositRule),
      checkout_url: paymentUrl,
    };
  });

export const getPaymentStatus = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        appointmentId: z.string().uuid().optional(),
        bookingRequestId: z.string().uuid().optional(),
      })
      .refine((v) => v.appointmentId || v.bookingRequestId, { message: "payment_target_required" })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = admin();
    await expireStaleReservations(sb);
    await rateLimitOrThrow({
      key: `payment-status:${data.bookingRequestId ?? data.appointmentId}:${getRequestFingerprint()}`,
      limit: 80,
      windowMs: 10 * 60 * 1000,
    });
    const query = sb
      .from("payment_intents")
      .select(
        "id, studio_id, status, stripe_payment_intent_id, stripe_checkout_session_id, stripe_connect_account_id, hosted_voucher_url, expires_at, method, appointment_id, booking_request_id, amount_cents, currency",
      )
      .order("created_at", { ascending: false })
      .limit(1);

    const { data: pi } = data.bookingRequestId
      ? await query.eq("booking_request_id", data.bookingRequestId).maybeSingle()
      : await query.eq("appointment_id", data.appointmentId).maybeSingle();

    let currentPi = pi;
    if (
      currentPi &&
      currentPi.booking_request_id &&
      currentPi.stripe_checkout_session_id &&
      (currentPi.status !== "succeeded" || !currentPi.appointment_id)
    ) {
      currentPi = await reconcileCheckoutSessionPayment(sb, currentPi);
    }

    if (
      currentPi?.stripe_payment_intent_id &&
      ["requires_action", "processing"].includes(currentPi.status as string)
    ) {
      const stripe = createStripeClient(stripeEnv());
      const fresh = await stripe.paymentIntents.retrieve(
        currentPi.stripe_payment_intent_id as string,
        undefined,
        currentPi.stripe_connect_account_id ? { stripeAccount: currentPi.stripe_connect_account_id as string } : undefined,
      );
      const freshStatus = normalizeStripeStatus(fresh.status);
      const expiresAt = currentPi.expires_at;

      await sb
        .from("payment_intents")
        .update({
          status: freshStatus,
          expires_at: expiresAt,
          failure_reason: freshStatus === "failed" ? fresh.last_payment_error?.message ?? "payment_failed" : null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_payment_intent_id", currentPi.stripe_payment_intent_id);

      currentPi = {
        ...currentPi,
        status: freshStatus,
        expires_at: expiresAt,
      };

      if (freshStatus === "failed" || freshStatus === "canceled") {
        await failBookingRequest(
          sb,
          data.bookingRequestId ?? null,
          fresh.last_payment_error?.message ?? "payment_failed",
          currentPi.stripe_payment_intent_id as string,
        );
      }
    }

    const statusInfo = await loadReservationStatus(sb, data.bookingRequestId, data.appointmentId);

    if (currentPi?.stripe_payment_intent_id && currentPi.status === "succeeded") {
      if (data.bookingRequestId && statusInfo.reservationStatus !== "confirmed") {
        let appointmentId: string;
        try {
          appointmentId = await confirmBookingRequest(
            sb,
            data.bookingRequestId,
            currentPi.stripe_payment_intent_id as string,
          );
        } catch (error) {
          await sb.from("booking_payment_requests").update({
            status: "paid_conflict",
            failure_reason: error instanceof Error ? error.message : "payment_confirmation_failed",
            updated_at: new Date().toISOString(),
          }).eq("id", data.bookingRequestId).neq("status", "converted");
          await (await import("@/lib/paid-booking-alert.server")).notifyPaidBookingRequiresReview(sb, {
            studioId: currentPi.studio_id,
            bookingRequestId: data.bookingRequestId,
            paymentId: currentPi.id,
          }).catch((noticeError) => console.error("paid_booking_review_notification_failed", noticeError));
          return {
            appointmentStatus: null,
            reservationStatus: "paid_conflict",
            appointmentId: null,
            payment: { ...currentPi, status: "succeeded" },
          };
        }
        await sendAppointmentConfirmationMessage(sb, {
          stripePaymentIntentId: currentPi.stripe_payment_intent_id as string,
        }).catch((sendError) => {
          console.error("senddm whatsapp confirmation failed", sendError);
        });
        return {
          appointmentStatus: "confirmed",
          reservationStatus: "confirmed",
          appointmentId,
          payment: { ...currentPi, appointment_id: appointmentId },
        };
      }
      if (data.appointmentId && statusInfo.appointmentStatus !== "confirmed") {
        const { error: appointmentError } = await sb
          .from("appointments")
          .update({ status: "confirmed", updated_at: new Date().toISOString() })
          .eq("id", data.appointmentId)
          .eq("status", "pending_payment");
        if (appointmentError) throw appointmentError;
        const verifiedStatus = await loadReservationStatus(sb, undefined, data.appointmentId);
        if (verifiedStatus.appointmentStatus !== "confirmed") {
          return { ...verifiedStatus, reservationStatus: "paid_conflict", payment: currentPi };
        }
        await sendAppointmentConfirmationMessage(sb, {
          stripePaymentIntentId: currentPi.stripe_payment_intent_id as string,
        }).catch((sendError) => {
          console.error("senddm whatsapp confirmation failed", sendError);
        });
        return {
          appointmentStatus: "confirmed",
          reservationStatus: "confirmed",
          appointmentId: data.appointmentId,
          payment: currentPi,
        };
      }
    }

    return { ...statusInfo, payment: currentPi ?? null };
  });

export const reconcileStudioBookingPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ReconcileStudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertStudioAccess(sb, (context as any).userId, data.studioId, {
      entitlement: "online_payments",
    });
    await rateLimitOrThrow({
      key: `payment-reconcile:${data.studioId}:${getRequestFingerprint()}`,
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });

    const { data: rows, error } = await sb
      .from("payment_intents")
      .select(
        "id, studio_id, status, stripe_payment_intent_id, stripe_checkout_session_id, stripe_connect_account_id, client_secret, hosted_voucher_url, expires_at, method, appointment_id, booking_request_id, amount_cents, currency",
      )
      .eq("studio_id", data.studioId)
      .in("status", ["requires_action", "processing", "expired", "failed", "succeeded"])
      .or("status.neq.succeeded,appointment_id.is.null")
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) throw new Error(error.message);

    let updated = 0;
    for (const row of rows ?? []) {
      try {
        const before = row.status;
        const next = await reconcileCheckoutSessionPayment(sb, row);
        if (next?.status !== before || next?.appointment_id !== row.appointment_id) updated += 1;
      } catch (error) {
        console.error("studio_payment_reconcile_failed", {
          paymentIntentId: row.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { checked: rows?.length ?? 0, updated };
  });

async function loadPaymentSource(
  sb: any,
  bookingRequestId: string | null,
  appointmentId: string | null,
) {
  if (bookingRequestId) {
    const { data: req, error } = await sb
      .from("booking_payment_requests")
      .select(
        "id, studio_id, starts_at, total_price, status, client_name, client_email, client_phone, expires_at, deposit_rule_snapshot",
      )
      .eq("id", bookingRequestId)
      .maybeSingle();
    if (error || !req) throw new Error("booking_request_not_found");
    if (!["awaiting_payment", "processing"].includes(req.status as string))
      throw new Error("booking_request_not_payable");
    if (new Date(req.expires_at as string).getTime() < Date.now())
      throw new Error("booking_request_expired");
    const studio = await loadStudio(sb, req.studio_id as string);
    return buildPaymentSource({
      studio,
      studioId: req.studio_id as string,
      startsAt: req.starts_at as string,
      totalPrice: req.total_price,
      clientName: req.client_name as string,
      clientEmail: req.client_email as string | null,
      clientPhone: req.client_phone as string,
      depositRuleSnapshot: req.deposit_rule_snapshot,
    });
  }

  const { data: appt, error: apptErr } = await sb
    .from("appointments")
    .select("id, studio_id, total_price, status, starts_at, client_id, deposit_rule_snapshot")
    .eq("id", appointmentId)
    .maybeSingle();
  if (apptErr || !appt) throw new Error("appointment_not_found");
  if (appt.status !== "pending_payment") throw new Error("appointment_not_pending");

  const { data: client } = await sb
    .from("clients")
    .select("name, email, phone")
    .eq("id", appt.client_id as string)
    .maybeSingle();
  const studio = await loadStudio(sb, appt.studio_id as string);
  return buildPaymentSource({
    studio,
    studioId: appt.studio_id as string,
    startsAt: appt.starts_at as string,
    totalPrice: appt.total_price,
    clientName: (client?.name as string) || "Cliente",
    clientEmail: (client?.email as string | null) ?? null,
    clientPhone: (client?.phone as string) ?? "",
    depositRuleSnapshot: appt.deposit_rule_snapshot,
  });
}

async function loadStudio(sb: any, studioId: string) {
  const { data: studio } = await sb
    .from("studios")
    .select(
      "name, slug, timezone, accepted_payment_methods, currency, deposit_percent, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_onboarding_completed, stripe_connect_mb_way_payments_enabled",
    )
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) throw new Error("studio_not_found");
  return studio;
}

function buildPaymentSource(input: {
  studio: any;
  studioId: string;
  startsAt: string;
  totalPrice: unknown;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string;
  depositRuleSnapshot?: unknown;
}) {
  const totalCents = Math.round(Number(input.totalPrice) * 100);
  const depositRule = readDepositSnapshot(input.depositRuleSnapshot, input.studio);
  const charge = calculateDepositCharge(totalCents, depositRule);
  return {
    studioId: input.studioId,
    studioName: input.studio.name as string,
    studioSlug: input.studio.slug as string,
    studioTimezone: input.studio.timezone as string,
    startsAt: input.startsAt,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    clientPhone: input.clientPhone,
    acceptedMethods: normalizeAcceptedPaymentMethods(
      input.studio.accepted_payment_methods as string[] | null,
    ),
    currency: ((input.studio.currency as string) || "eur").toLowerCase(),
    depositRule,
    totalCents,
    amountCents: charge.amountCents,
    isFullPayment: charge.isFullPayment,
    // Stripe Connect — deposits go directly to the studio's account
    connectAccountId: (input.studio.stripe_connect_account_id as string | null) ?? null,
    connectChargesEnabled: Boolean(input.studio.stripe_connect_charges_enabled),
    connectOnboardingCompleted: Boolean(input.studio.stripe_connect_onboarding_completed),
    connectMbWayPaymentsEnabled: Boolean(input.studio.stripe_connect_mb_way_payments_enabled),
  };
}

function assertCheckoutAmountSupported(
  amountCents: number,
  currency: string,
  method: CheckoutPaymentMethod,
) {
  const minimumCents = minimumStripeCheckoutAmountCents(currency, method);
  if (amountCents >= minimumCents) return;

  const formatter = new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  const calculated = formatter.format(amountCents / 100);
  const minimum = formatter.format(minimumCents / 100);
  const methodLabel = method === "mb_way" ? "MB WAY" : "cartão";
  throw new Error(
    `O sinal calculado (${calculated}) é inferior ao mínimo de ${minimum} permitido pelo Stripe para ${methodLabel}. O valor configurado pelo estúdio não foi alterado.`,
  );
}

function normalizePortugueseMobile(phone?: string | null) {
  const raw = phone?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  if (/^9\d{8}$/.test(digits)) return `+351${digits}`;
  if (/^3519\d{8}$/.test(digits)) return `+${digits}`;
  if (/^003519\d{8}$/.test(digits)) return `+${digits.slice(2)}`;
  return null;
}

async function loadReservationStatus(sb: any, bookingRequestId?: string, appointmentId?: string) {
  if (bookingRequestId) {
    const { data: req } = await sb
      .from("booking_payment_requests")
      .select("status, appointment_id, studio_id")
      .eq("id", bookingRequestId)
      .maybeSingle();
    const { data: appointment } = req?.appointment_id
      ? await sb.from("appointments").select("id,status")
        .eq("id", req.appointment_id).eq("studio_id", req.studio_id).maybeSingle()
      : { data: null };
    const existsAndBooked = appointment && ["confirmed", "completed", "no_show"].includes(appointment.status);
    return {
      appointmentStatus: existsAndBooked ? "confirmed" : null,
      reservationStatus: req?.status === "converted"
        ? existsAndBooked ? "confirmed" : "paid_conflict"
        : (req?.status ?? null),
      appointmentId: existsAndBooked ? req.appointment_id as string : null,
    };
  }
  const { data: appt } = await sb
    .from("appointments")
    .select("status")
    .eq("id", appointmentId)
    .maybeSingle();
  return {
    appointmentStatus: appt?.status ?? null,
    reservationStatus: appt?.status ?? null,
    appointmentId: appointmentId ?? null,
  };
}

function normalizeStripeStatus(status: string) {
  if (status === "succeeded") return "succeeded";
  if (status === "processing") return "processing";
  if (status === "canceled") return "canceled";
  if (status === "requires_payment_method") return "failed";
  return "requires_action";
}

function normalizeAcceptedPaymentMethods(methods?: string[] | null) {
  const normalized = (methods ?? ["mb_way", "card"]).filter(
    (method): method is "mb_way" | "card" => method === "mb_way" || method === "card",
  );
  return normalized.length > 0 ? normalized : ["mb_way", "card"];
}

function stripePaymentFailureReason(error: unknown, method: "mb_way" | "card") {
  const err = error as {
    code?: string;
    param?: string;
    message?: string;
    raw?: { code?: string; param?: string; message?: string };
  };
  const message = `${err.message ?? ""} ${err.raw?.message ?? ""}`.toLowerCase();
  const param = err.param ?? err.raw?.param ?? "";
  if (
    param.includes("payment_method_types") ||
    message.includes("payment method type") ||
    message.includes("activated in your dashboard")
  ) {
    return method === "card" ? "card_unavailable" : "mb_way_unavailable";
  }
  if (method === "mb_way" && (message.includes("phone") || message.includes("telem"))) {
    return "mb_way_phone_invalid";
  }
  if (err.code === "payment_intent_payment_attempt_expired") return "payment_expired";
  return "payment_method_unavailable";
}

function formatIntentResponse(row: any, totalCents: number, depositRule: DepositRule) {
  return {
    payment_intent_id: row.id,
    stripe_payment_intent_id: row.stripe_payment_intent_id,
    client_secret: row.client_secret,
    appointment_id: row.appointment_id ?? null,
    booking_request_id: row.booking_request_id ?? null,
    method: row.method,
    status: row.status,
    hosted_voucher_url: row.hosted_voucher_url ?? null,
    amount_cents: row.amount_cents,
    total_cents: totalCents,
    deposit_percent: depositRule.mode === "percent" ? depositRule.percent : null,
    deposit_mode: depositRule.mode,
    deposit_fixed_cents: depositRule.mode === "fixed" ? depositRule.fixed_cents : null,
    remaining_cents: Math.max(0, totalCents - Number(row.amount_cents)),
    currency: row.currency,
    expires_at: row.expires_at,
  };
}
