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
  return { paidOnlineCents, reservedCents: Math.min(reservedCents, paidOnlineCents) };
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
) {
  await (sb as any).from("studio_notifications").insert({
    studio_id: studioId,
    kind: "withdrawal_requested",
    title: "Novo pedido de levantamento",
    body: `Pedido de levantamento de ${formatCents(amountCents)} aguardando processamento.`,
    payload: { withdrawal_request_id: requestId, amount_cents: amountCents, status },
  });
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
