import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { sendAppointmentConfirmationMessage } from "@/lib/whatsapp.functions";
import { getRequestFingerprint, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

const PAYMENT_METHOD_MESSAGES: Record<string, string> = {
  mb_way_unavailable:
    "MB WAY não está disponível nesta configuração. Escolha outro método ou contacte o estúdio.",
  multibanco_unavailable:
    "Multibanco não está disponível nesta configuração. Escolha outro método ou contacte o estúdio.",
  mb_way_phone_invalid:
    "MB WAY exige um telemóvel português válido. Verifique o número e recomece a reserva.",
  payment_method_unavailable:
    "Este método de pagamento não está disponível de momento. Escolha outro método.",
};

function admin(): any {
  return getAdminClient();
}

function stripeEnv(): StripeEnv {
  return process.env.STRIPE_ENV === "live" ? "live" : "sandbox";
}

function appBaseUrl() {
  const configured = (
    process.env.APP_URL ??
    process.env.VITE_APP_URL ??
    process.env.PUBLIC_APP_URL ??
    ""
  ).replace(/\/$/, "");
  if (configured) return configured;

  const request = getRequest();
  const origin = request?.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  const host = request?.headers.get("host");
  if (host) {
    const proto = request?.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return "http://127.0.0.1:5173";
}

const CreateIntentInput = z
  .object({
    appointmentId: z.string().uuid().optional(),
    bookingRequestId: z.string().uuid().optional(),
    method: z.enum(["mb_way", "multibanco"]),
  })
  .refine((v) => v.appointmentId || v.bookingRequestId, {
    message: "booking_request_required",
  });

async function confirmBookingRequest(sb: any, requestId: string, stripePaymentIntentId: string) {
  const stripe = createStripeClient(stripeEnv());
  const fresh = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
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
  const { data: previous } = await sb
    .from("payment_intents")
    .select("status")
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
    await sb
      .from("payment_intents")
      .update({
        failure_reason: error.message,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_payment_intent_id", stripePaymentIntentId);
    throw new Error(error.message);
  }
  if (previous?.status !== "succeeded") {
    await sendAppointmentConfirmationMessage(sb, { stripePaymentIntentId }).catch((sendError) => {
      console.error("twilio whatsapp confirmation failed", sendError);
    });
  }
  return data as string;
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
        "id, stripe_payment_intent_id, client_secret, amount_cents, currency, method, status, multibanco_entity, multibanco_reference, hosted_voucher_url, expires_at, appointment_id, booking_request_id",
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
      const source = await loadPaymentSource(sb, bookingRequestId, appointmentId);
      return {
        ...formatIntentResponse(existing, source.totalCents, source.depositPercent),
        mb_way_phone:
          existing.method === "mb_way" ? normalizePortugueseMobile(source.clientPhone) : null,
        checkout_url: existing.hosted_voucher_url,
      };
    }

    const source = await loadPaymentSource(sb, bookingRequestId, appointmentId);
    const accepted = source.acceptedMethods;
    if (!accepted.includes(data.method)) throw new Error("payment_method_not_accepted");

    const totalCents = source.totalCents;
    const amountCents = source.amountCents;
    if (amountCents < 50) throw new Error("amount_too_low");

    const paymentMethodType = data.method === "mb_way" ? "mb_way" : "multibanco";
    const billingPhone =
      data.method === "mb_way" ? normalizePortugueseMobile(source.clientPhone) : source.clientPhone;
    if (data.method === "mb_way" && !billingPhone) {
      throw new Error(PAYMENT_METHOD_MESSAGES.mb_way_phone_invalid);
    }

    const stripe = createStripeClient(stripeEnv());
    const checkoutExpiresAt =
      Math.floor(Date.now() / 1000) + (data.method === "multibanco" ? 24 * 60 * 60 : 30 * 60);
    const checkoutSessionPayload = {
      mode: "payment" as const,
      customer_email: source.clientEmail || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: source.currency,
            unit_amount: amountCents,
            product_data: {
              name: `Sinal de reserva - ${source.studioName}`,
              description: new Date(source.startsAt).toLocaleString("pt-PT"),
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
        metadata: {
          ...(bookingRequestId ? { booking_request_id: bookingRequestId } : {}),
          ...(appointmentId ? { appointment_id: appointmentId } : {}),
          studio_id: source.studioId,
          client_phone: billingPhone || source.clientPhone,
          payment_kind: "booking_deposit",
          method: data.method,
        },
      },
      success_url: `${appBaseUrl()}/s/${source.studioSlug}?payment=success`,
      cancel_url: `${appBaseUrl()}/s/${source.studioSlug}?payment=cancelled`,
      expires_at: checkoutExpiresAt,
      expand: ["payment_intent"],
    };
    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: [paymentMethodType],
        customer_email: source.clientEmail || undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: source.currency,
              unit_amount: amountCents,
              product_data: {
                name: `Sinal de reserva - ${source.studioName}`,
                description: new Date(source.startsAt).toLocaleString("pt-PT"),
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
          metadata: {
            ...(bookingRequestId ? { booking_request_id: bookingRequestId } : {}),
            ...(appointmentId ? { appointment_id: appointmentId } : {}),
            studio_id: source.studioId,
            client_phone: billingPhone || source.clientPhone,
            payment_kind: "booking_deposit",
            method: data.method,
          },
        },
        success_url: `${appBaseUrl()}/s/${source.studioSlug}?payment=success`,
        cancel_url: `${appBaseUrl()}/s/${source.studioSlug}?payment=cancelled`,
        expires_at: checkoutExpiresAt,
        expand: ["payment_intent"],
      });
    } catch (error) {
      if (data.method === "multibanco") {
        try {
          checkoutSession = await stripe.checkout.sessions.create(checkoutSessionPayload);
          console.warn("stripe_booking_checkout_dynamic_fallback", {
            method: data.method,
            originalMessage: error instanceof Error ? error.message : String(error),
          });
        } catch (fallbackError) {
          const reason = stripePaymentFailureReason(fallbackError, data.method);
          console.error("stripe_booking_checkout_failed", {
            method: data.method,
            reason,
            fallback: "dynamic_payment_methods",
            message:
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          throw new Error(
            PAYMENT_METHOD_MESSAGES[reason] ?? PAYMENT_METHOD_MESSAGES.payment_method_unavailable,
          );
        }
      } else {
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
    }
    const checkoutPaymentIntent =
      typeof checkoutSession.payment_intent === "object" ? checkoutSession.payment_intent : null;
    const expiresAt = checkoutSession.expires_at
      ? new Date(checkoutSession.expires_at * 1000).toISOString()
      : data.method === "multibanco"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { data: checkoutRow, error: checkoutInsertError } = await sb
      .from("payment_intents")
      .insert({
        studio_id: source.studioId,
        appointment_id: appointmentId,
        booking_request_id: bookingRequestId,
        stripe_payment_intent_id: checkoutPaymentIntent?.id ?? null,
        client_secret: checkoutPaymentIntent?.client_secret ?? null,
        amount_cents: amountCents,
        currency: source.currency,
        method: data.method,
        status: normalizeStripeStatus(checkoutPaymentIntent?.status ?? "requires_action"),
        hosted_voucher_url: checkoutSession.url ?? null,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (checkoutInsertError) throw new Error(checkoutInsertError.message);

    if (bookingRequestId) {
      await sb
        .from("booking_payment_requests")
        .update({
          status: "processing",
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingRequestId)
        .in("status", ["awaiting_payment", "processing"]);
    }

    return {
      ...formatIntentResponse(checkoutRow, totalCents, source.depositPercent),
      checkout_url: checkoutSession.url,
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
        "status, stripe_payment_intent_id, multibanco_entity, multibanco_reference, hosted_voucher_url, expires_at, method, appointment_id, booking_request_id, amount_cents, currency",
      )
      .order("created_at", { ascending: false })
      .limit(1);

    const { data: pi } = data.bookingRequestId
      ? await query.eq("booking_request_id", data.bookingRequestId).maybeSingle()
      : await query.eq("appointment_id", data.appointmentId).maybeSingle();

    let currentPi = pi;
    if (
      currentPi?.stripe_payment_intent_id &&
      ["requires_action", "processing"].includes(currentPi.status as string)
    ) {
      const stripe = createStripeClient(stripeEnv());
      const fresh = await stripe.paymentIntents.retrieve(
        currentPi.stripe_payment_intent_id as string,
        { expand: ["latest_charge"] },
      );
      const freshStatus = normalizeStripeStatus(fresh.status);
      const nextAction = (fresh as any).next_action;
      const latestCharge = typeof fresh.latest_charge === "object" ? (fresh.latest_charge as any) : null;
      const chargeDetails = latestCharge?.payment_method_details ?? null;
      const multibancoDetails =
        nextAction?.multibanco_display_details ?? chargeDetails?.multibanco ?? null;
      const expiresAt = multibancoDetails?.expires_at
        ? new Date(multibancoDetails.expires_at * 1000).toISOString()
        : currentPi.expires_at;

      await sb
        .from("payment_intents")
        .update({
          status: freshStatus,
          multibanco_entity: multibancoDetails?.entity ?? currentPi.multibanco_entity ?? null,
          multibanco_reference:
            multibancoDetails?.reference ?? currentPi.multibanco_reference ?? null,
          hosted_voucher_url:
            multibancoDetails?.hosted_voucher_url ?? currentPi.hosted_voucher_url ?? null,
          expires_at: expiresAt,
          failure_reason: freshStatus === "failed" ? fresh.last_payment_error?.message ?? "payment_failed" : null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_payment_intent_id", currentPi.stripe_payment_intent_id);

      currentPi = {
        ...currentPi,
        status: freshStatus,
        multibanco_entity: multibancoDetails?.entity ?? currentPi.multibanco_entity,
        multibanco_reference: multibancoDetails?.reference ?? currentPi.multibanco_reference,
        hosted_voucher_url: multibancoDetails?.hosted_voucher_url ?? currentPi.hosted_voucher_url,
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
          await sb
            .from("booking_payment_requests")
            .update({
              status: "failed",
              failure_reason: error instanceof Error ? error.message : "payment_confirmation_failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", data.bookingRequestId);
          return {
            appointmentStatus: null,
            reservationStatus: "failed",
            appointmentId: null,
            payment: { ...currentPi, status: "failed" },
          };
        }
        await sendAppointmentConfirmationMessage(sb, {
          stripePaymentIntentId: currentPi.stripe_payment_intent_id as string,
        }).catch((sendError) => {
          console.error("twilio whatsapp confirmation failed", sendError);
        });
        return {
          appointmentStatus: "confirmed",
          reservationStatus: "confirmed",
          appointmentId,
          payment: { ...currentPi, appointment_id: appointmentId },
        };
      }
      if (data.appointmentId && statusInfo.appointmentStatus !== "confirmed") {
        await sb
          .from("appointments")
          .update({ status: "confirmed", updated_at: new Date().toISOString() })
          .eq("id", data.appointmentId)
          .eq("status", "pending_payment");
        await sendAppointmentConfirmationMessage(sb, {
          stripePaymentIntentId: currentPi.stripe_payment_intent_id as string,
        }).catch((sendError) => {
          console.error("twilio whatsapp confirmation failed", sendError);
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

async function loadPaymentSource(
  sb: any,
  bookingRequestId: string | null,
  appointmentId: string | null,
) {
  if (bookingRequestId) {
    const { data: req, error } = await sb
      .from("booking_payment_requests")
      .select(
        "id, studio_id, starts_at, total_price, status, client_name, client_email, client_phone, expires_at",
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
    });
  }

  const { data: appt, error: apptErr } = await sb
    .from("appointments")
    .select("id, studio_id, total_price, status, starts_at, client_id")
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
  });
}

async function loadStudio(sb: any, studioId: string) {
  const { data: studio } = await sb
    .from("studios")
    .select("name, slug, accepted_payment_methods, currency, deposit_percent")
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
}) {
  const totalCents = Math.round(Number(input.totalPrice) * 100);
  const depositPercent = Math.max(10, Math.min(100, Number(input.studio.deposit_percent ?? 25)));
  const amountCents =
    depositPercent >= 100
      ? totalCents
      : Math.max(50, Math.round((totalCents * depositPercent) / 100));
  return {
    studioId: input.studioId,
    studioName: input.studio.name as string,
    studioSlug: input.studio.slug as string,
    startsAt: input.startsAt,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    clientPhone: input.clientPhone,
    acceptedMethods: (input.studio.accepted_payment_methods as string[] | null) ?? [
      "mb_way",
      "multibanco",
    ],
    currency: ((input.studio.currency as string) || "eur").toLowerCase(),
    depositPercent,
    totalCents,
    amountCents,
  };
}

function resolveBillingEmail(email?: string | null) {
  const trimmed = email?.trim();
  if (trimmed && /\S+@\S+\.\S+/.test(trimmed)) return trimmed;
  return "reservas@charmbooknow.test";
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
      .select("status, appointment_id")
      .eq("id", bookingRequestId)
      .maybeSingle();
    return {
      appointmentStatus: req?.appointment_id ? "confirmed" : null,
      reservationStatus: req?.status === "converted" ? "confirmed" : (req?.status ?? null),
      appointmentId: (req?.appointment_id as string | null) ?? null,
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

function stripePaymentFailureReason(error: unknown, method: "mb_way" | "multibanco") {
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
    return method === "multibanco" ? "multibanco_unavailable" : "mb_way_unavailable";
  }
  if (method === "mb_way" && (message.includes("phone") || message.includes("telem"))) {
    return "mb_way_phone_invalid";
  }
  if (err.code === "payment_intent_payment_attempt_expired") return "payment_expired";
  return "payment_method_unavailable";
}

function formatIntentResponse(row: any, totalCents: number, depositPercent: number) {
  return {
    payment_intent_id: row.id,
    stripe_payment_intent_id: row.stripe_payment_intent_id,
    client_secret: row.client_secret,
    appointment_id: row.appointment_id ?? null,
    booking_request_id: row.booking_request_id ?? null,
    method: row.method,
    status: row.status,
    multibanco_entity: row.multibanco_entity ?? null,
    multibanco_reference: row.multibanco_reference ?? null,
    hosted_voucher_url: row.hosted_voucher_url ?? null,
    amount_cents: row.amount_cents,
    total_cents: totalCents,
    deposit_percent: depositPercent,
    remaining_cents: Math.max(0, totalCents - Number(row.amount_cents)),
    currency: row.currency,
    expires_at: row.expires_at,
  };
}
