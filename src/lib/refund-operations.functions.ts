import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccessWithOptions } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { createStripeClient, getConfiguredStripeEnv, type StripeEnv } from "@/lib/stripe.server";
import { assertDirectChargeAccount, assertExactStripeAmount } from "@/lib/stripe-financial-integrity";

function admin(): SupabaseClient {
  return getAdminClient();
}

function stripeEnv(): StripeEnv {
  return getConfiguredStripeEnv();
}

const StudioRefundActionInput = z.object({
  studioId: z.string().uuid(),
  requestId: z.string().uuid(),
  status: z.enum(["in_review", "approved", "rejected"]),
  note: z.string().trim().max(500).optional().nullable(),
});

const PlatformRefundActionInput = z.object({
  requestId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
  amountCents: z.number().int().positive().optional(),
});

const PlatformRejectRefundInput = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().min(4).max(500),
});

export const updateStudioRefundRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioRefundActionInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId as string;
    await assertStudioAccessWithOptions(sb, userId, data.studioId, {
      entitlement: "online_payments",
    });

    const request = await loadRefundForAction(sb, data.requestId);
    if (request.studio_id !== data.studioId) throw new Response("forbidden", { status: 403 });
    if (["approved", "rejected", "refunded"].includes(request.status)) {
      throw new Error("refund_already_processed");
    }

    if (data.status === "approved") {
      await assertRefundPaymentIsLiveSucceeded(sb, request);
    }

    const { data: updated, error } = await (sb as any)
      .from("refund_requests")
      .update({
        status: data.status,
        decision_note: data.note?.trim() || request.decision_note || null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id,status")
      .eq("id", data.requestId)
      .eq("studio_id", data.studioId)
      .in("status", ["pending", "in_review"])
      .maybeSingle();
    if (error) throw error;
    if (!updated?.id) throw new Error("refund_already_processed");

    await insertFinancialAuditLog(sb, {
      studioId: data.studioId,
      actorUserId: userId,
      entityType: "refund_request",
      entityId: data.requestId,
      action: `studio_refund_${data.status}`,
      amountCents: request.amount_cents,
      metadata: { previous_status: request.status, payment_intent_id: request.payment_intent_id },
    });

    await insertClientRefundDecisionNotification(sb, request, data.status, data.note?.trim() || null);

    return { ok: true };
  });

export const getRefundOperations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = admin();
    await assertSaasOwner(sb, (context as any).userId);

    const { data, error } = await (sb as any)
      .from("refund_requests")
      .select(
        "id,studio_id,appointment_id,booking_request_id,payment_intent_id,amount_cents,client_name,client_phone,client_email,reason,status,decision_note,reviewed_at,created_at,updated_at,platform_processed_at,stripe_refund_id,stripe_refund_status,stripe_last_synced_at,refund_method,admin_notes,studios:studio_id(id,name,slug),payment_intents:payment_intent_id(id,amount_cents,currency,method,status,stripe_payment_intent_id,stripe_checkout_session_id,stripe_connect_account_id,refunded_amount_cents,created_at),appointments:appointment_id(id,starts_at,total_price,appointment_services(services(name)))",
      )
      .in("status", ["approved", "refunded", "rejected"])
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    return (data ?? []).map((row: any) => normalizeRefundOperation(row));
  });

export const markRefundCompleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PlatformRefundActionInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId as string;
    await assertSaasOwner(sb, userId);
    const request = await loadRefundForAction(sb, data.requestId);
    if (request.status === "refunded" && request.stripe_refund_id) {
      return { ok: true, stripeRefundId: request.stripe_refund_id, status: "succeeded", reused: true };
    }
    if (request.status !== "approved") throw new Error("refund_not_approved");
    await assertRefundPaymentIsLiveSucceeded(sb, request);

    const paymentIntentId = String(request.payment?.stripe_payment_intent_id || "");
    const connectedAccountId = String(request.payment?.stripe_connect_account_id || "");
    assertDirectChargeAccount(connectedAccountId, connectedAccountId);
    const stripe = createStripeClient(stripeEnv());
    const paymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["latest_charge"] },
      { stripeAccount: connectedAccountId },
    );
    assertExactStripeAmount({
      expectedAmountCents: request.payment_amount_cents,
      stripeAmountCents: Number(paymentIntent.amount || 0),
      receivedAmountCents: Number(paymentIntent.amount_received || 0),
      succeeded: paymentIntent.status === "succeeded",
    });
    if (paymentIntent.status !== "succeeded") throw new Error("refund_payment_not_succeeded");

    const latestCharge = paymentIntent.latest_charge;
    const chargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
    if (!chargeId) throw new Error("refund_charge_missing");
    const charge = await stripe.charges.retrieve(chargeId, {}, { stripeAccount: connectedAccountId });
    const remainingCents = Number(charge.amount || 0) - Number(charge.amount_refunded || 0);
    const amountCents = data.amountCents ?? request.requested_amount_cents ?? remainingCents;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > remainingCents) {
      throw new Error("refund_amount_invalid");
    }

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        reason: "requested_by_customer",
        metadata: {
          refund_request_id: data.requestId,
          studio_id: request.studio_id,
          payment_record_id: request.payment_intent_id as string,
        },
      },
      {
        stripeAccount: connectedAccountId,
        idempotencyKey: `refund-request:${data.requestId}:${amountCents}`,
      },
    );

    const stripeRefundStatus = String(refund.status ?? "pending");
    const completed = stripeRefundStatus === "succeeded";

    const { error } = await (sb as any)
      .from("refund_requests")
      .update({
        status: completed ? "refunded" : "approved",
        amount_cents: amountCents,
        platform_processed_at: completed ? new Date().toISOString() : null,
        platform_processed_by: userId,
        stripe_refund_id: refund.id,
        stripe_refund_status: stripeRefundStatus,
        stripe_last_synced_at: new Date().toISOString(),
        refund_method: "stripe_connect_direct_charge",
        admin_notes: data.note?.trim() || request.admin_notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .eq("status", "approved");
    if (error) throw error;

    await insertFinancialAuditLog(sb, {
      studioId: request.studio_id,
      actorUserId: userId,
      entityType: "refund_request",
      entityId: data.requestId,
      action: completed ? "stripe_refund_succeeded" : "stripe_refund_created",
      amountCents,
      metadata: {
        payment_intent_id: request.payment_intent_id,
        stripe_refund_id: refund.id,
        stripe_refund_status: stripeRefundStatus,
        refund_method: "stripe_connect_direct_charge",
      },
    });

    return { ok: true, stripeRefundId: refund.id, status: stripeRefundStatus, reused: false };
  });

export const rejectApprovedRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PlatformRejectRefundInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId as string;
    await assertSaasOwner(sb, userId);
    const request = await loadRefundForAction(sb, data.requestId);
    if (request.status === "refunded") throw new Error("refund_already_processed");

    const { error } = await (sb as any)
      .from("refund_requests")
      .update({
        status: "rejected",
        admin_notes: data.reason,
        platform_processed_at: new Date().toISOString(),
        platform_processed_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .eq("status", "approved");
    if (error) throw error;

    await insertFinancialAuditLog(sb, {
      studioId: request.studio_id,
      actorUserId: userId,
      entityType: "refund_request",
      entityId: data.requestId,
      action: "platform_refund_rejected",
      amountCents: request.amount_cents,
      metadata: { reason: data.reason, payment_intent_id: request.payment_intent_id },
    });

    return { ok: true };
  });

async function assertSaasOwner(sb: SupabaseClient, userId: string) {
  const { data, error } = await (sb as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "saas_owner")
    .limit(1)
    .maybeSingle();
  if (error || data?.role !== "saas_owner") throw new Response("forbidden", { status: 403 });
}

async function loadRefundForAction(sb: SupabaseClient, requestId: string) {
  const { data, error } = await (sb as any)
    .from("refund_requests")
    .select(
      "id,studio_id,appointment_id,payment_intent_id,amount_cents,client_phone,client_email,status,decision_note,stripe_refund_id,stripe_refund_status,refund_method,admin_notes,payment_intents:payment_intent_id(id,amount_cents,status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_connect_account_id,refunded_amount_cents)",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (error || !data?.id) throw new Error("refund_request_not_found");
  const payment = Array.isArray(data.payment_intents) ? data.payment_intents[0] : data.payment_intents;
  return {
    id: data.id as string,
    studio_id: data.studio_id as string,
    appointment_id: data.appointment_id as string | null,
    payment_intent_id: data.payment_intent_id as string | null,
    client_phone: data.client_phone as string | null,
    client_email: data.client_email as string | null,
    status: data.status as string,
    decision_note: data.decision_note as string | null,
    stripe_refund_id: data.stripe_refund_id as string | null,
    refund_method: data.refund_method as string | null,
    admin_notes: data.admin_notes as string | null,
    payment,
    requested_amount_cents: data.amount_cents == null ? null : Number(data.amount_cents),
    payment_amount_cents: Number(payment?.amount_cents || 0),
    amount_cents: Number(payment?.amount_cents || 0),
  };
}

async function assertRefundPaymentIsLiveSucceeded(
  sb: SupabaseClient,
  request: Awaited<ReturnType<typeof loadRefundForAction>>,
) {
  if (!request.payment_intent_id || !request.payment) throw new Error("refund_payment_missing");
  if (request.payment.status !== "succeeded") throw new Error("refund_payment_not_succeeded");
  if (
    !String(request.payment.stripe_payment_intent_id || "").startsWith("pi_") ||
    !String(request.payment.stripe_connect_account_id || "").startsWith("acct_")
  ) {
    throw new Error("refund_payment_not_live");
  }

  const { data: duplicate } = await (sb as any)
    .from("refund_requests")
    .select("id")
    .eq("payment_intent_id", request.payment_intent_id)
    .eq("status", "refunded")
    .neq("id", request.id)
    .limit(1)
    .maybeSingle();
  if (duplicate?.id) throw new Error("refund_already_processed");
}

async function insertFinancialAuditLog(
  sb: SupabaseClient,
  input: {
    studioId: string;
    actorUserId: string;
    entityType: string;
    entityId: string;
    action: string;
    amountCents: number;
    metadata?: Record<string, unknown>;
  },
) {
  await (sb as any).from("financial_audit_logs").insert({
    studio_id: input.studioId,
    actor_user_id: input.actorUserId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    amount_cents: input.amountCents,
    currency: "eur",
    metadata: input.metadata ?? {},
  });
}

async function insertClientRefundDecisionNotification(
  sb: SupabaseClient,
  request: Awaited<ReturnType<typeof loadRefundForAction>>,
  status: "in_review" | "approved" | "rejected",
  note: string | null,
) {
  if (status === "in_review") return;

  const recipient = request.client_email || request.client_phone;
  if (!recipient) return;

  const approved = status === "approved";
  await (sb as any).from("notifications_log").insert({
    studio_id: request.studio_id,
    appointment_id: request.appointment_id,
    channel: request.client_email ? "email" : "whatsapp",
    recipient,
    kind: "refund_decision",
    status: "queued",
    payload: {
      refund_request_id: request.id,
      decision: status,
      amount_cents: request.amount_cents,
      message: approved
        ? "O pedido de reembolso foi aprovado pelo estúdio."
        : "O pedido de reembolso foi recusado pelo estúdio.",
      note,
    },
  });
}

function normalizeRefundOperation(row: any) {
  const payment = Array.isArray(row.payment_intents) ? row.payment_intents[0] : row.payment_intents;
  const appointment = Array.isArray(row.appointments) ? row.appointments[0] : row.appointments;
  const serviceNames =
    appointment?.appointment_services
      ?.map((line: any) => line.services?.name)
      .filter(Boolean)
      .join(", ") || "Marcação";
  const amountCents = Number(row.amount_cents ?? payment?.amount_cents ?? 0);
  return {
    id: row.id as string,
    studioId: row.studio_id as string,
    studioName: row.studios?.name ?? "Estúdio",
    clientName: row.client_name ?? "Cliente",
    clientPhone: row.client_phone ?? null,
    clientEmail: row.client_email ?? null,
    amountCents,
    currency: payment?.currency ?? "eur",
    serviceName: serviceNames,
    reason: row.reason as string,
    status: row.status as "approved" | "refunded" | "rejected",
    decisionNote: row.decision_note as string | null,
    adminNotes: row.admin_notes as string | null,
    paymentMethod: payment?.method ?? "online",
    stripePaymentIntentId: payment?.stripe_payment_intent_id ?? null,
    stripeCheckoutSessionId: payment?.stripe_checkout_session_id ?? null,
    stripeRefundId: row.stripe_refund_id as string | null,
    stripeRefundStatus: row.stripe_refund_status as string | null,
    refundMethod: row.refund_method as string | null,
    paidAt: payment?.created_at ?? null,
    appointmentAt: appointment?.starts_at ?? null,
    requestedAt: row.created_at as string,
    reviewedAt: row.reviewed_at as string | null,
    processedAt: row.platform_processed_at as string | null,
    coveredByLivePayment:
      payment?.status === "succeeded" &&
      String(payment?.stripe_payment_intent_id || "").startsWith("pi_") &&
      String(payment?.stripe_connect_account_id || "").startsWith("acct_"),
  };
}
