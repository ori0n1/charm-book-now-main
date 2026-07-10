import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccessWithOptions, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

function admin(): SupabaseClient {
  return getAdminClient();
}

const StudioInput = z.object({ studioId: z.string().uuid() });

const CancelWithdrawalInput = z.object({
  studioId: z.string().uuid(),
  requestId: z.string().uuid(),
});

const OperatorWithdrawalActionInput = z.object({
  requestId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
  proofUrl: z.string().trim().url().max(500).optional().nullable(),
});

const OperatorFailWithdrawalInput = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().min(4).max(500),
});

const PayoutSettingsInput = z.object({
  studioId: z.string().uuid(),
  fiscalName: z.string().trim().min(2).max(160),
  nif: z.string().trim().regex(/^\d{9}$/),
  payoutMethod: z.enum(["iban", "mb_way"]),
  iban: z.string().trim().max(64).optional().nullable(),
  mbWayPhone: z.string().trim().max(32).optional().nullable(),
});

type WithdrawalStatus = "in_review" | "processing" | "completed" | "failed" | "canceled";

export const getWithdrawalSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertStudioAccessWithOptions(sb, (context as any).userId, data.studioId, {
      requirePremium: true,
    });
    const [settings, totals, requests] = await Promise.all([
      loadSettings(sb, data.studioId),
      loadWithdrawalTotals(sb, data.studioId),
      loadRecentRequests(sb, data.studioId),
    ]);
    const availableCents = Math.max(0, totals.paidOnlineCents - totals.reservedCents);
    return {
      settings,
      paidOnlineCents: totals.paidOnlineCents,
      reservedCents: totals.reservedCents,
      availableCents,
      requests,
    };
  });

export const savePayoutSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PayoutSettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertStudioAccessWithOptions(sb, (context as any).userId, data.studioId, {
      requirePremium: true,
    });

    const iban = data.payoutMethod === "iban" ? normalizeIban(data.iban) : null;
    const mbWayPhone = data.payoutMethod === "mb_way" ? normalizePhone(data.mbWayPhone) : null;
    if (data.payoutMethod === "iban" && !iban) throw new Error("iban_required");
    if (data.payoutMethod === "mb_way" && !mbWayPhone) throw new Error("mb_way_phone_required");

    const payload = {
      studio_id: data.studioId,
      fiscal_name: data.fiscalName.trim(),
      nif: data.nif.trim().replace(/\D/g, ""),
      payout_mode: "manual",
      payout_method: data.payoutMethod,
      iban,
      mb_way_phone: mbWayPhone,
      stripe_account_id: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await (sb as any)
      .from("studio_payout_settings")
      .upsert(payload, { onConflict: "studio_id" });
    if (error) throw error;
    return { ok: true, settings: await loadSettings(sb, data.studioId) };
  });

export const requestStudioWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId;
    await assertStudioAccessWithOptions(sb, userId, data.studioId, { requirePremium: true });
    await rateLimitOrThrow({
      key: `withdrawal:${userId}:${data.studioId}`,
      limit: 4,
      windowMs: 10 * 60 * 1000,
    });

    const settings = await loadSettings(sb, data.studioId);
    if (!settings) return { needsSetup: true };
    if (settings.payoutMethod === "iban" && !settings.iban) return { needsSetup: true };
    if (settings.payoutMethod === "mb_way" && !settings.mbWayPhone) return { needsSetup: true };

    const totals = await loadWithdrawalTotals(sb, data.studioId);
    const availableCents = Math.max(0, totals.paidOnlineCents - totals.reservedCents);
    if (availableCents <= 0) throw new Error("no_withdrawable_balance");

    const requestPayload = {
      studio_id: data.studioId,
      requested_by: userId,
      amount_cents: availableCents,
      currency: "eur",
      status: "in_review",
      payout_mode: "manual",
      payout_method: settings.payoutMethod,
      fiscal_name: settings.fiscalName,
      nif: settings.nif,
      iban_last4: settings.iban ? settings.iban.slice(-4) : null,
      mb_way_phone: settings.mbWayPhone,
      stripe_account_id: null,
    };

    const { data: inserted, error } = await (sb as any)
      .from("withdrawal_requests")
      .insert(requestPayload)
      .select("id,amount_cents,status")
      .single();
    if (error) throw error;

    const status = normalizeWithdrawalStatus(inserted.status as string);
    await insertWithdrawalNotification(sb, data.studioId, inserted.id, availableCents, status);

    return { needsSetup: false, requestId: inserted.id as string, amountCents: availableCents, status };
  });

export const cancelStudioWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CancelWithdrawalInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId;
    await assertStudioAccessWithOptions(sb, userId, data.studioId, { requirePremium: true });

    const { error } = await (sb as any)
      .from("withdrawal_requests")
      .update({
        status: "canceled",
        failure_reason: "Pedido cancelado pelo estúdio.",
        status_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .eq("studio_id", data.studioId)
      .eq("status", "in_review");

    if (error) throw error;
    return { ok: true };
  });

export const getWithdrawalOperations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = admin();
    await assertSaasOwner(sb, (context as any).userId);

    const { data, error } = await (sb as any)
      .from("withdrawal_requests")
      .select(
        "id,studio_id,amount_cents,currency,status,payout_method,payout_mode,fiscal_name,nif,iban_last4,mb_way_phone,requested_at,reviewed_at,processed_at,paid_at,updated_at,status_updated_at,proof_url,failure_reason,admin_notes,studios:studio_id(id,name,slug)",
      )
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const rows = data ?? [];
    const studioIds = [...new Set(rows.map((row: any) => row.studio_id).filter(Boolean))] as string[];
    const totalsByStudio = new Map<
      string,
      { paidOnlineCents: number; reservedCents: number; rawReservedCents: number }
    >();
    await Promise.all(
      studioIds.map(async (studioId) => {
        totalsByStudio.set(studioId, await loadWithdrawalTotals(sb, studioId));
      }),
    );

    return rows.map((row: any) => {
      const totals = totalsByStudio.get(row.studio_id) ?? {
        paidOnlineCents: 0,
        reservedCents: 0,
        rawReservedCents: 0,
      };
      const amountCents = Number(row.amount_cents || 0);
      const rawReservedCents = totals.rawReservedCents ?? totals.reservedCents;
      const otherReservedCents =
        ["pending", "in_review", "processing", "completed", "paid"].includes(String(row.status))
          ? Math.max(0, rawReservedCents - amountCents)
          : rawReservedCents;
      const liveAvailableForRequestCents = Math.max(0, totals.paidOnlineCents - otherReservedCents);
      return {
        id: row.id as string,
        studioId: row.studio_id as string,
        studioName: row.studios?.name ?? "Estúdio",
        studioSlug: row.studios?.slug ?? null,
        amountCents,
        currency: (row.currency as string) ?? "eur",
        status: normalizeWithdrawalStatus(row.status as string),
        payoutMethod: row.payout_method === "mb_way" ? "mb_way" : "iban",
        payoutMode: row.payout_mode === "stripe_automatic" ? "stripe_automatic" : "manual",
        fiscalName: row.fiscal_name as string,
        nif: row.nif as string,
        ibanLast4: row.iban_last4 as string | null,
        mbWayPhone: row.mb_way_phone as string | null,
        requestedAt: row.requested_at as string,
        reviewedAt: row.reviewed_at as string | null,
        processedAt: row.processed_at as string | null,
        paidAt: row.paid_at as string | null,
        updatedAt: (row.status_updated_at || row.updated_at) as string | null,
        proofUrl: row.proof_url as string | null,
        failureReason: row.failure_reason as string | null,
        adminNotes: row.admin_notes as string | null,
        confirmedLiveCents: totals.paidOnlineCents,
        reservedCents: rawReservedCents,
        liveAvailableForRequestCents,
        coveredByLiveBalance: amountCents <= liveAvailableForRequestCents,
      };
    });
  });

export const getFinancialAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = admin();
    await assertSaasOwner(sb, (context as any).userId);

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [studiosResult, subscriptionsResult, paymentsResult, clientsResult, notificationsResult, auditLogsResult] = await Promise.all([
      (sb as any)
        .from("studios")
        .select("id,is_active,plan,subscription_status,trial_ends_at,created_at")
        .limit(1000),
      (sb as any)
        .from("subscriptions")
        .select("id,status,plan,current_period_end,updated_at")
        .limit(1000),
      (sb as any)
        .from("payment_intents")
        .select("id,studio_id,amount_cents,currency,method,status,created_at,stripe_payment_intent_id,stripe_checkout_session_id,studios:studio_id(name,slug)")
        .order("created_at", { ascending: false })
        .limit(500),
      (sb as any)
        .from("clients")
        .select("id,created_at,studio_id")
        .gte("created_at", startOfMonth.toISOString())
        .limit(1000),
      (sb as any)
        .from("studio_notifications")
        .select("id,studio_id,kind,title,body,read_at,created_at,studios:studio_id(name,slug)")
        .in("kind", ["withdrawal_requested", "refund_request", "payment_failed", "payment_confirmed"])
        .order("created_at", { ascending: false })
        .limit(24),
      (sb as any)
        .from("financial_audit_logs")
        .select("id,studio_id,actor_user_id,entity_type,entity_id,action,amount_cents,currency,metadata,created_at,studios:studio_id(name,slug)")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    const studios = studiosResult.data ?? [];
    const payments = paymentsResult.data ?? [];
    const succeededPayments = payments.filter((row: any) => row.status === "succeeded");
    const failedPayments = payments.filter((row: any) => ["failed", "expired", "canceled"].includes(String(row.status)));
    const activeStudios = studios.filter((row: any) => row.is_active !== false);
    const trialStudios = activeStudios.filter((row: any) => row.subscription_status === "trialing" || row.plan === "trial");
    const premiumStudios = activeStudios.filter((row: any) => row.subscription_status === "active");
    const blockedStudios = studios.filter((row: any) => row.is_active === false);
    const pendingPaymentStudios = new Set(
      payments
        .filter((row: any) => ["processing", "requires_action", "requires_payment_method", "pending"].includes(String(row.status)))
        .map((row: any) => row.studio_id)
        .filter(Boolean),
    );

    const paymentSummary = {
      totalRevenueCents: sumPaymentCents(succeededPayments),
      dayRevenueCents: sumPaymentCentsSince(succeededPayments, startOfDay),
      weekRevenueCents: sumPaymentCentsSince(succeededPayments, startOfWeek),
      monthRevenueCents: sumPaymentCentsSince(succeededPayments, startOfMonth),
      yearRevenueCents: sumPaymentCentsSince(succeededPayments, startOfYear),
      failedPayments: failedPayments.length,
      recentPayments: payments.slice(0, 12).map((row: any) => ({
        id: row.id as string,
        studioName: row.studios?.name ?? "Estúdio",
        kind: "payment",
        title: row.status === "succeeded" ? "Pagamento recebido" : "Pagamento em análise",
        amountCents: Number(row.amount_cents || 0),
        currency: (row.currency as string) ?? "eur",
        status: row.status as string,
        method: row.method as string,
        createdAt: row.created_at as string,
      })),
    };
    const subscriptions = subscriptionsResult.data ?? [];
    const subscriptionSummary = {
      active: subscriptions.filter((row: any) => row.status === "active").length,
      trialing: subscriptions.filter((row: any) => row.status === "trialing").length,
      canceled: subscriptions.filter((row: any) => ["canceled", "cancelled"].includes(String(row.status))).length,
      pastDue: subscriptions.filter((row: any) => ["past_due", "unpaid", "incomplete"].includes(String(row.status))).length,
    };

    return {
      activeStudios: activeStudios.length,
      activeSubscriptions: subscriptionSummary.active + subscriptionSummary.trialing,
      subscriptionSummary,
      newClientsThisMonth: (clientsResult.data ?? []).length,
      studioSummary: {
        active: activeStudios.length,
        trial: trialStudios.length,
        premium: premiumStudios.length,
        blocked: blockedStudios.length,
        pendingPayments: pendingPaymentStudios.size,
      },
      paymentSummary,
      adminEvents: (notificationsResult.data ?? []).map((row: any) => ({
        id: row.id as string,
        studioName: row.studios?.name ?? "Estúdio",
        studioSlug: row.studios?.slug ?? null,
        kind: row.kind as string,
        title: row.title as string,
        body: row.body as string,
        readAt: row.read_at as string | null,
        createdAt: row.created_at as string,
      })),
      auditLogs: (auditLogsResult.data ?? []).map((row: any) => ({
        id: row.id as string,
        studioName: row.studios?.name ?? "Estúdio",
        studioSlug: row.studios?.slug ?? null,
        actorUserId: row.actor_user_id as string | null,
        entityType: row.entity_type as string,
        entityId: row.entity_id as string,
        action: row.action as string,
        amountCents: Number(row.amount_cents || 0),
        currency: (row.currency as string) ?? "eur",
        metadata: row.metadata ?? {},
        createdAt: row.created_at as string,
      })),
    };
  });

export const markWithdrawalProcessing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => OperatorWithdrawalActionInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertSaasOwner(sb, (context as any).userId);
    const request = await loadWithdrawalRequestForOperator(sb, data.requestId);
    await assertRequestCoveredByLiveBalance(sb, request);

    const { error } = await (sb as any)
      .from("withdrawal_requests")
      .update({
        status: "processing",
        reviewed_at: request.reviewed_at ?? new Date().toISOString(),
        processed_at: new Date().toISOString(),
        status_updated_at: new Date().toISOString(),
        admin_notes: data.note?.trim() || request.admin_notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .in("status", ["in_review", "pending"]);
    if (error) throw error;

    await insertFinancialAuditLog(sb, {
      studioId: request.studio_id,
      actorUserId: (context as any).userId,
      entityType: "withdrawal_request",
      entityId: data.requestId,
      action: "platform_withdrawal_processing",
      amountCents: Number(request.amount_cents || 0),
      metadata: { previous_status: request.status, note: data.note ?? null },
    });

    await insertWithdrawalNotification(
      sb,
      request.studio_id,
      request.id,
      Number(request.amount_cents || 0),
      "processing",
      "Recebimento online em processamento",
      "O registo foi validado e está a ser processado.",
    );
    return { ok: true };
  });

export const markWithdrawalCompleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => OperatorWithdrawalActionInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertSaasOwner(sb, (context as any).userId);
    const request = await loadWithdrawalRequestForOperator(sb, data.requestId);
    await assertRequestCoveredByLiveBalance(sb, request);

    const { error } = await (sb as any)
      .from("withdrawal_requests")
      .update({
        status: "completed",
        reviewed_at: request.reviewed_at ?? new Date().toISOString(),
        processed_at: request.processed_at ?? new Date().toISOString(),
        paid_at: new Date().toISOString(),
        proof_url: data.proofUrl?.trim() || request.proof_url || null,
        admin_notes: data.note?.trim() || request.admin_notes || null,
        status_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .in("status", ["in_review", "pending", "processing"]);
    if (error) throw error;

    await insertFinancialAuditLog(sb, {
      studioId: request.studio_id,
      actorUserId: (context as any).userId,
      entityType: "withdrawal_request",
      entityId: data.requestId,
      action: "platform_withdrawal_completed",
      amountCents: Number(request.amount_cents || 0),
      metadata: {
        previous_status: request.status,
        proof_url: data.proofUrl ?? null,
        note: data.note ?? null,
      },
    });

    await insertWithdrawalNotification(
      sb,
      request.studio_id,
      request.id,
      Number(request.amount_cents || 0),
      "completed",
      "Recebimento online confirmado",
      `O registo de ${formatCents(Number(request.amount_cents || 0))} foi marcado como concluído.`,
    );
    return { ok: true };
  });

export const rejectWithdrawalRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => OperatorFailWithdrawalInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertSaasOwner(sb, (context as any).userId);
    const request = await loadWithdrawalRequestForOperator(sb, data.requestId);

    const { error } = await (sb as any)
      .from("withdrawal_requests")
      .update({
        status: "failed",
        failure_reason: data.reason,
        reviewed_at: request.reviewed_at ?? new Date().toISOString(),
        status_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .in("status", ["in_review", "pending", "processing"]);
    if (error) throw error;

    await insertFinancialAuditLog(sb, {
      studioId: request.studio_id,
      actorUserId: (context as any).userId,
      entityType: "withdrawal_request",
      entityId: data.requestId,
      action: "platform_withdrawal_rejected",
      amountCents: Number(request.amount_cents || 0),
      metadata: { previous_status: request.status, reason: data.reason },
    });

    await insertWithdrawalNotification(
      sb,
      request.studio_id,
      request.id,
      Number(request.amount_cents || 0),
      "failed",
      "Recebimento online recusado",
      data.reason,
    );
    return { ok: true };
  });

async function loadSettings(sb: SupabaseClient, studioId: string) {
  const { data } = await (sb as any)
    .from("studio_payout_settings")
    .select("fiscal_name,nif,payout_method,iban,mb_way_phone")
    .eq("studio_id", studioId)
    .maybeSingle();
  if (!data) return null;
  return {
    fiscalName: data.fiscal_name as string,
    nif: data.nif as string,
    payoutMethod: data.payout_method === "mb_way" ? "mb_way" : "iban",
    iban: data.iban as string | null,
    mbWayPhone: data.mb_way_phone as string | null,
  };
}

async function loadWithdrawalTotals(sb: SupabaseClient, studioId: string) {
  const [{ data: payments }, { data: refundRequests }, { data: requests }] = await Promise.all([
    (sb as any)
      .from("payment_intents")
      .select("id,amount_cents,appointment_id")
      .eq("studio_id", studioId)
      .eq("status", "succeeded")
      .like("stripe_checkout_session_id", "cs_live_%")
      .not("appointment_id", "is", null),
    (sb as any)
      .from("refund_requests")
      .select("payment_intent_id,status")
      .eq("studio_id", studioId)
      .in("status", ["approved", "refunded"]),
    (sb as any)
      .from("withdrawal_requests")
      .select("amount_cents,status")
      .eq("studio_id", studioId),
  ]);
  const appointmentIds = [
    ...new Set((payments ?? []).map((row: { appointment_id?: string | null }) => row.appointment_id).filter(Boolean)),
  ];
  const { data: appointments } =
    appointmentIds.length > 0
      ? await (sb as any).from("appointments").select("id,status").in("id", appointmentIds)
      : { data: [] };
  const appointmentStatusById = new Map(
    (appointments ?? []).map((row: { id: string; status?: string }) => [row.id, row.status ?? ""]),
  );
  const refundedPaymentIds = new Set(
    (refundRequests ?? [])
      .map((row: { payment_intent_id?: string | null }) => row.payment_intent_id)
      .filter(Boolean),
  );
  const paidOnlineCents = (payments ?? []).reduce(
    (sum: number, row: { id: string; amount_cents: number; appointment_id?: string | null }) => {
      if (refundedPaymentIds.has(row.id)) return sum;
      if (["cancelled", "no_show"].includes(String(appointmentStatusById.get(row.appointment_id ?? "") ?? ""))) {
        return sum;
      }
      return sum + Number(row.amount_cents || 0);
    },
    0,
  );
  const reservedCents = (requests ?? []).reduce(
    (sum: number, row: { amount_cents: number; status: string }) =>
      ["pending", "in_review", "processing", "completed", "paid"].includes(row.status)
        ? sum + Number(row.amount_cents || 0)
        : sum,
    0,
  );
  return {
    paidOnlineCents,
    reservedCents: Math.min(reservedCents, paidOnlineCents),
    rawReservedCents: reservedCents,
  };
}

async function loadRecentRequests(sb: SupabaseClient, studioId: string) {
  const { data } = await (sb as any)
    .from("withdrawal_requests")
    .select("id,amount_cents,currency,status,payout_method,requested_at,reviewed_at,processed_at,paid_at,updated_at,status_updated_at,proof_url,failure_reason")
    .eq("studio_id", studioId)
    .order("requested_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((row: any) => ({
    id: row.id as string,
    amountCents: Number(row.amount_cents || 0),
    currency: (row.currency as string) ?? "eur",
    status: normalizeWithdrawalStatus(row.status as string),
    payoutMethod: row.payout_method === "mb_way" ? "mb_way" : "iban",
    requestedAt: row.requested_at as string,
    reviewedAt: row.reviewed_at as string | null,
    processedAt: row.processed_at as string | null,
    paidAt: row.paid_at as string | null,
    updatedAt: (row.status_updated_at || row.updated_at) as string | null,
    proofUrl: row.proof_url as string | null,
    failureReason: row.failure_reason as string | null,
  }));
}

async function insertWithdrawalNotification(
  sb: SupabaseClient,
  studioId: string,
  requestId: string,
  amountCents: number,
  status: WithdrawalStatus,
  title = "Novo registo financeiro",
  body = `Registo financeiro de ${formatCents(amountCents)} aguardando processamento.`,
) {
  await (sb as any).from("studio_notifications").insert({
    studio_id: studioId,
    kind: "withdrawal_requested",
    title,
    body,
    payload: { withdrawal_request_id: requestId, amount_cents: amountCents, status },
  });
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

async function assertSaasOwner(sb: SupabaseClient, userId: string) {
  const { data, error } = await (sb as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "saas_owner")
    .limit(1)
    .maybeSingle();
  if (error || data?.role !== "saas_owner") {
    throw new Response("forbidden", { status: 403 });
  }
}

async function loadWithdrawalRequestForOperator(sb: SupabaseClient, requestId: string) {
  const { data, error } = await (sb as any)
    .from("withdrawal_requests")
    .select("id,studio_id,amount_cents,status,reviewed_at,processed_at,proof_url,admin_notes")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !data?.id) throw new Error("withdrawal_request_not_found");
  return data as {
    id: string;
    studio_id: string;
    amount_cents: number;
    status: string;
    reviewed_at: string | null;
    processed_at: string | null;
    proof_url: string | null;
    admin_notes: string | null;
  };
}

async function assertRequestCoveredByLiveBalance(
  sb: SupabaseClient,
  request: { id: string; studio_id: string; amount_cents: number },
) {
  const totals = await loadWithdrawalTotals(sb, request.studio_id);
  const otherReservedCents = Math.max(0, totals.rawReservedCents - Number(request.amount_cents || 0));
  const availableForRequestCents = Math.max(0, totals.paidOnlineCents - otherReservedCents);
  if (Number(request.amount_cents || 0) > availableForRequestCents) {
    throw new Error("withdrawal_not_covered_by_live_balance");
  }
}

function normalizeIban(value?: string | null) {
  const normalized = value?.replace(/\s+/g, "").toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) throw new Error("invalid_iban");
  return normalized;
}

function normalizePhone(value?: string | null) {
  const normalized = value?.replace(/[^\d+]/g, "");
  if (!normalized) return null;
  if (!/^\+?\d{9,15}$/.test(normalized)) throw new Error("invalid_mb_way_phone");
  return normalized;
}

function normalizeWithdrawalStatus(status: string): WithdrawalStatus {
  if (status === "paid") return "completed";
  if (status === "rejected") return "canceled";
  if (status === "in_review") return "in_review";
  if (status === "processing" || status === "completed" || status === "failed" || status === "canceled") return status;
  return "in_review";
}

function formatCents(value: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(
    value / 100,
  );
}

function sumPaymentCents(rows: Array<{ amount_cents?: number | null }>) {
  return rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
}

function sumPaymentCentsSince(rows: Array<{ amount_cents?: number | null; created_at?: string | null }>, since: Date) {
  const sinceTime = since.getTime();
  return rows.reduce((sum, row) => {
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
    return createdAt >= sinceTime ? sum + Number(row.amount_cents || 0) : sum;
  }, 0);
}
