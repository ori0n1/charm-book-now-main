import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase-admin.server";

function admin(): any {
  return getAdminClient();
}

export const getClientAppointment = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(16) }).parse(input))
  .handler(async ({ data }) => {
    const sb = admin();
    const appt = await loadAppointmentByToken(sb, data.token);
    if (!appt) throw new Response("appointment_not_found", { status: 404 });
    return buildAppointmentPayload(sb, appt);
  });

export const cancelClientAppointment = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(16) }).parse(input))
  .handler(async ({ data }) => {
    const sb = admin();
    const appt = await loadAppointmentByToken(sb, data.token);
    if (!appt) throw new Response("appointment_not_found", { status: 404 });
    const policy = getActionPolicy(appt);
    if (!policy.canCancel) throw new Error(policy.blockReason);

    const { error } = await sb
      .from("appointments")
      .update({
        status: "cancelled",
        cancellation_reason: "client_request",
        updated_at: new Date().toISOString(),
      })
      .eq("id", appt.id)
      .eq("status", appt.status);
    if (error) throw new Error(error.message);

    const fresh = await loadAppointmentByToken(sb, data.token);
    return buildAppointmentPayload(sb, fresh ?? appt);
  });

export const requestClientRefund = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ token: z.string().min(16), reason: z.string().min(5) }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = admin();
    const appt = await loadAppointmentByToken(sb, data.token);
    if (!appt) throw new Response("appointment_not_found", { status: 404 });
    const policy = getActionPolicy(appt);
    if (!policy.canRequestRefund) throw new Error(policy.refundBlockReason);

    const { data: payment } = await sb
      .from("payment_intents")
      .select("id")
      .eq("appointment_id", appt.id)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: refund, error } = await sb
      .from("refund_requests")
      .insert({
        studio_id: appt.studio_id,
        appointment_id: appt.id,
        payment_intent_id: payment?.id ?? null,
        client_name: appt.clients?.name ?? null,
        client_phone: appt.clients?.phone ?? null,
        client_email: appt.clients?.email ?? null,
        reason: data.reason.trim(),
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error("Nao foi possivel enviar o pedido de reembolso.");
    return { ok: true, refundId: refund?.id ?? null };
  });

async function loadAppointmentByToken(sb: any, token: string) {
  const { data, error } = await sb
    .from("appointments")
    .select(
      "id,public_token,studio_id,starts_at,ends_at,status,total_price,cancellation_reason,clients(name,phone,email),staff(name),studios(id,name,slug,whatsapp,phone,cancellation_min_notice_hours,cancellation_after_deadline_policy,refund_requests_enabled,cancellation_policy_text)",
    )
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function buildAppointmentPayload(sb: any, appt: any) {
  const { data: services } = await sb
    .from("appointment_services")
    .select("price,duration_min,services(name)")
    .eq("appointment_id", appt.id);
  const { data: payment } = await sb
    .from("payment_intents")
    .select("id,amount_cents,status")
    .eq("appointment_id", appt.id)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: refund } = await sb
    .from("refund_requests")
    .select("id,status,created_at")
    .eq("appointment_id", appt.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const policy = getActionPolicy(appt);
  return {
    id: appt.id,
    token: appt.public_token,
    status: appt.status,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    totalPrice: Number(appt.total_price || 0),
    clientName: appt.clients?.name ?? "Cliente",
    clientPhone: appt.clients?.phone ?? "",
    studioName: appt.studios?.name ?? "Estudio",
    studioSlug: appt.studios?.slug ?? "",
    studioPhone: appt.studios?.whatsapp ?? appt.studios?.phone ?? "",
    staffName: appt.staff?.name ?? "Profissional",
    services: (services ?? []).map((line: any) => ({
      name: line.services?.name ?? "Servico",
      price: Number(line.price || 0),
      durationMin: Number(line.duration_min || 0),
    })),
    paidAmount: Number(payment?.amount_cents || 0) / 100,
    refundRequest: refund ?? null,
    policy,
    cancellationText: appt.studios?.cancellation_policy_text ?? null,
  };
}

function getActionPolicy(appt: any) {
  const startsAt = new Date(appt.starts_at).getTime();
  const endsAt = new Date(appt.ends_at ?? appt.starts_at).getTime();
  const now = Date.now();
  const noticeHours = Number(appt.studios?.cancellation_min_notice_hours ?? 24);
  const deadline = startsAt - noticeHours * 60 * 60 * 1000;
  const happened = endsAt < now;
  const cancelled = appt.status === "cancelled";
  const beforeDeadline = now <= deadline;
  const refundPolicy = appt.studios?.cancellation_after_deadline_policy ?? "non_refundable";
  const refundable = Boolean(appt.studios?.refund_requests_enabled) && refundPolicy === "refund_allowed";

  const blockReason = happened
    ? "Esta marcacao ja aconteceu."
    : cancelled
      ? "Esta marcacao ja foi cancelada."
      : beforeDeadline
        ? ""
        : "O prazo de cancelamento ja passou.";

  const refundBlockReason = !refundable
    ? "O sinal desta marcacao nao e reembolsavel."
    : blockReason || "";

  return {
    noticeHours,
    deadlineAt: new Date(deadline).toISOString(),
    beforeDeadline,
    happened,
    cancelled,
    refundable,
    canCancel: !happened && !cancelled && beforeDeadline,
    canRequestRefund: !happened && !cancelled && beforeDeadline && refundable,
    blockReason,
    refundBlockReason,
    refundPolicy,
  };
}
