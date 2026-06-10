import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccessWithOptions } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

function admin(): SupabaseClient {
  return getAdminClient();
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
  stripeRefundId: z.string().trim().max(120).optional().nullable(),
  refundMethod: z.string().trim().max(80).optional().nullable(),
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
    await assertStudioAccessWithOptions(sb, userId, data.studioId, { requirePremium: true });

    const request = await loadRefundForAction(sb, data.requestId);
    if (request.studio_id !== data.studioId) throw new Response("forbidden", { status: 403 });
    if (request.status === "refunded") throw new Error("refund_already_processed");

    if (data.status === "approved") {
      await assertRefundPaymentIsLiveSucceeded(sb, request);
    }

    const { error } = await (sb as any)
      .from("refund_requests")
      .update({
        status: data.status,
        decision_note: data.note?.trim() || request.decision_note || null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .eq("studio_id", data.studioId)
      .in("status", ["pending", "in_review", "approved", "rejected"]);
    if (error) throw error;

    await insertFinancialAuditLog(sb, {
      studioId: data.studioId,
      actorUserId: userId,
      entityType: "refund_request",
      entityId: data.requestId,
      action: `studio_refund_${data.status}`,
      amountCents: request.amount_cents,
      metadata: { previous_status: request.status, payment_intent_id: request.payment_intent_id },
    });

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
        "id,studio_id,appointment_id,booking_request_id,payment_intent_id,client_name,client_phone,client_email,reason,status,decision_note,reviewed_at,created_at,updated_at,platform_processed_at,stripe_refund_id,refund_method,admin_notes,studios:studio_id(id,name,slug),payment_intents:payment_intent_id(id,amount_cents,currency,method,status,stripe_payment_intent_id,stripe_checkout_session_id,created_at),appointments:appointment_id(id,starts_at,total_price,appointment_services(services(name)))",
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
    if (request.status === "refunded") throw new Error("refund_already_processed");
    await assertRefundPaymentIsLiveSucceeded(sb, request);

    const { error } = await (sb as any)
      .from("refund_requests")
      .update({
        status: "refunded",
        platform_processed_at: new Date().toISOString(),
        platform_processed_by: userId,
        stripe_refund_id: data.stripeRefundId?.trim() || request.stripe_refund_id || null,
        refund_method: data.refundMethod?.trim() || request.refund_method || "manual",
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
      action: "platform_refund_completed",
      amountCents: request.amount_cents,
      metadata: {
        payment_intent_id: request.payment_intent_id,
        stripe_refund_id: data.stripeRefundId ?? null,
        refund_method: data.refundMethod ?? "manual",
      },
    });

    return { ok: true };
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
      "id,studio_id,payment_intent_id,status,decision_note,stripe_refund_id,refund_method,admin_notes,payment_intents:payment_intent_id(id,amount_cents,status,stripe_checkout_session_id,stripe_payment_intent_id)",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (error || !data?.id) throw new Error("refund_request_not_found");
  const payment = Array.isArray(data.payment_intents) ? data.payment_intents[0] : data.payment_intents;
  return {
    id: data.id as string,
    studio_id: data.studio_id as string,
    payment_intent_id: data.payment_intent_id as string | null,
    status: data.status as string,
    decision_note: data.decision_note as string | null,
    stripe_refund_id: data.stripe_refund_id as string | null,
    refund_method: data.refund_method as string | null,
    admin_notes: data.admin_notes as string | null,
    payment,
    amount_cents: Number(payment?.amount_cents || 0),
  };
}

async function assertRefundPaymentIsLiveSucceeded(
  sb: SupabaseClient,
  request: Awaited<ReturnType<typeof loadRefundForAction>>,
) {
  if (!request.payment_intent_id || !request.payment) throw new Error("refund_payment_missing");
  if (request.payment.status !== "succeeded") throw new Error("refund_payment_not_succeeded");
  if (!String(request.payment.stripe_checkout_session_id || "").startsWith("cs_live_")) {
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

function normalizeRefundOperation(row: any) {
  const payment = Array.isArray(row.payment_intents) ? row.payment_intents[0] : row.payment_intents;
  const appointment = Array.isArray(row.appointments) ? row.appointments[0] : row.appointments;
  const serviceNames =
    appointment?.appointment_services
      ?.map((line: any) => line.services?.name)
      .filter(Boolean)
      .join(", ") || "Marcação";
  const amountCents = Number(payment?.amount_cents || 0);
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
    refundMethod: row.refund_method as string | null,
    paidAt: payment?.created_at ?? null,
    appointmentAt: appointment?.starts_at ?? null,
    requestedAt: row.created_at as string,
    reviewedAt: row.reviewed_at as string | null,
    processedAt: row.platform_processed_at as string | null,
    coveredByLivePayment:
      payment?.status === "succeeded" &&
      String(payment?.stripe_checkout_session_id || "").startsWith("cs_live_"),
  };
}
