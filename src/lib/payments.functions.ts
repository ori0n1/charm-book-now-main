import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { sendAppointmentConfirmationMessage } from "@/lib/whatsapp.functions";
import { getRequestFingerprint, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

function admin(): any {
  return getAdminClient();
}

function stripeEnv(): StripeEnv {
  return process.env.STRIPE_ENV === "live" ? "live" : "sandbox";
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
  await sb.rpc("expire_pending_appointments").catch((error: unknown) => {
    console.error("expire_pending_appointments_failed", error);
  });
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
      return formatIntentResponse(existing, source.totalCents, source.depositPercent);
    }

    const source = await loadPaymentSource(sb, bookingRequestId, appointmentId);
    const accepted = source.acceptedMethods;
    if (!accepted.includes(data.method)) throw new Error("payment_method_not_accepted");

    const totalCents = source.totalCents;
    const amountCents = source.amountCents;
    if (amountCents < 50) throw new Error("amount_too_low");

    const stripe = createStripeClient(stripeEnv());
    const paymentMethodType = data.method === "mb_way" ? "mb_way" : "multibanco";
    const billingEmail = resolveBillingEmail(source.clientEmail);
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: source.currency,
      payment_method_types: [paymentMethodType],
      description: `Reserva ${source.studioName} — ${new Date(source.startsAt).toLocaleString("pt-PT")}`,
      receipt_email: source.clientEmail || undefined,
      metadata: {
        ...(bookingRequestId ? { booking_request_id: bookingRequestId } : {}),
        ...(appointmentId ? { appointment_id: appointmentId } : {}),
        studio_id: source.studioId,
        client_phone: source.clientPhone,
      },
    });

    const confirmed = await stripe.paymentIntents.confirm(intent.id, {
      payment_method_data: {
        type: paymentMethodType as "mb_way" | "multibanco",
        billing_details: {
          name: source.clientName || "Cliente",
          email: billingEmail,
          phone: source.clientPhone || undefined,
        },
      },
      expand: ["latest_charge"],
    });

    const nextAction = (confirmed as any).next_action;
    const latestCharge =
      typeof confirmed.latest_charge === "object" ? (confirmed.latest_charge as any) : null;
    const chargeDetails = latestCharge?.payment_method_details ?? null;
    const multibancoDetails =
      nextAction?.multibanco_display_details ?? chargeDetails?.multibanco ?? null;
    const mb = nextAction?.multibanco_display_details ?? null;
    const expiresAt = mb?.expires_at
      ? new Date(mb.expires_at * 1000).toISOString()
      : data.method === "multibanco"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const status = normalizeStripeStatus(confirmed.status);

    const { data: row, error: insErr } = await sb
      .from("payment_intents")
      .insert({
        studio_id: source.studioId,
        appointment_id: appointmentId,
        booking_request_id: bookingRequestId,
        stripe_payment_intent_id: confirmed.id,
        client_secret: confirmed.client_secret ?? null,
        amount_cents: amountCents,
        currency: source.currency,
        method: data.method,
        status,
        multibanco_entity: multibancoDetails?.entity ?? null,
        multibanco_reference: multibancoDetails?.reference ?? null,
        hosted_voucher_url: multibancoDetails?.hosted_voucher_url ?? null,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (insErr) throw new Error(insErr.message);

    if (status === "succeeded" && bookingRequestId) {
      const confirmedAppointmentId = await confirmBookingRequest(
        sb,
        bookingRequestId,
        confirmed.id,
      );
      await sendAppointmentConfirmationMessage(sb, {
        stripePaymentIntentId: confirmed.id,
      }).catch((sendError) => {
        console.error("twilio whatsapp confirmation failed", sendError);
      });
      return {
        ...formatIntentResponse(row, totalCents, source.depositPercent),
        appointment_id: confirmedAppointmentId,
      };
    }

    if (bookingRequestId && (status === "requires_action" || status === "processing")) {
      await sb
        .from("booking_payment_requests")
        .update({ status: "processing", expires_at: expiresAt, updated_at: new Date().toISOString() })
        .eq("id", bookingRequestId);
    }

    return formatIntentResponse(row, totalCents, source.depositPercent);
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

    const statusInfo = await loadReservationStatus(sb, data.bookingRequestId, data.appointmentId);

    if (pi?.stripe_payment_intent_id && pi.status === "succeeded") {
      if (data.bookingRequestId && statusInfo.reservationStatus !== "confirmed") {
        let appointmentId: string;
        try {
          appointmentId = await confirmBookingRequest(
            sb,
            data.bookingRequestId,
            pi.stripe_payment_intent_id as string,
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
            payment: { ...pi, status: "failed" },
          };
        }
        await sendAppointmentConfirmationMessage(sb, {
          stripePaymentIntentId: pi.stripe_payment_intent_id as string,
        }).catch((sendError) => {
          console.error("twilio whatsapp confirmation failed", sendError);
        });
        return {
          appointmentStatus: "confirmed",
          reservationStatus: "confirmed",
          appointmentId,
          payment: { ...pi, appointment_id: appointmentId },
        };
      }
      if (data.appointmentId && statusInfo.appointmentStatus !== "confirmed") {
        await sb
          .from("appointments")
          .update({ status: "confirmed", updated_at: new Date().toISOString() })
          .eq("id", data.appointmentId)
          .eq("status", "pending_payment");
        await sendAppointmentConfirmationMessage(sb, {
          stripePaymentIntentId: pi.stripe_payment_intent_id as string,
        }).catch((sendError) => {
          console.error("twilio whatsapp confirmation failed", sendError);
        });
        return {
          appointmentStatus: "confirmed",
          reservationStatus: "confirmed",
          appointmentId: data.appointmentId,
          payment: pi,
        };
      }
    }

    return { ...statusInfo, payment: pi ?? null };
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
    .select("name, accepted_payment_methods, currency, deposit_percent")
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
