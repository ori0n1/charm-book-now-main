import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getBookingManageability,
  getStudioBookingActionSetting,
} from "@/lib/booking-manageability";
import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";
import { getPublicReservationCode } from "@/lib/reservation-code";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { formatStudioDateTime } from "@/lib/studio-time";
import { sendAppointmentLifecycleMessage } from "@/lib/whatsapp.functions";

function admin(): any {
  return getAdminClient();
}

export const getClientAppointment = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(16) }).parse(input))
  .handler(async ({ data }) => {
    const sb = admin();
    const appt = await loadAppointmentByToken(sb, data.token);
    if (!appt) throw new Response("appointment_not_found", { status: 404 });
    await logClientAction(sb, appt, "open", "succeeded", "opened");
    return buildAppointmentPayload(sb, appt);
  });

export const logClientAppointmentAction = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(16),
        action: z.enum(["reschedule_open", "cancel_open", "contact_whatsapp"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = admin();
    const appt = await loadAppointmentByToken(sb, data.token);
    if (!appt) throw new Response("appointment_not_found", { status: 404 });
    await logClientAction(sb, appt, data.action, "started", data.action);
    return { ok: true };
  });

export const getClientRescheduleSlots = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ token: z.string().min(16), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = admin();
    const appt = await loadAppointmentByToken(sb, data.token);
    if (!appt) throw new Response("appointment_not_found", { status: 404 });
    const policy = getActionPolicy(appt);
    if (!policy.canReschedule) throw new Error(policy.rescheduleBlockReason);
    const durationMin = await getAppointmentDuration(sb, appt);
    const staffId = appt.staff?.id ?? appt.staff_id;
    const { data: slots, error } = await sb.rpc("get_available_slots", {
      p_studio_slug: appt.studios?.slug,
      p_staff_id: staffId,
      p_date: data.date,
      p_duration_min: durationMin,
      p_slot_step_min: 15,
    });
    if (error) throw new Error("Não foi possível consultar a disponibilidade.");
    return {
      date: data.date,
      durationMin,
      staffId,
      slots: (slots ?? []).map((slot: any) => ({
        staffId: slot.staff_id,
        startsAt: slot.slot_start,
        label: slot.slot_label,
      })),
    };
  });

export const rescheduleClientAppointment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ token: z.string().min(16), staffId: z.string().uuid(), startsAt: z.string().datetime() }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = admin();
    const appt = await loadAppointmentByToken(sb, data.token);
    if (!appt) throw new Response("appointment_not_found", { status: 404 });
    const policy = getActionPolicy(appt);
    if (!policy.canReschedule) {
      await logClientAction(sb, appt, "reschedule", "blocked", policy.rescheduleBlockReason);
      throw new Error(policy.rescheduleBlockReason);
    }
    const { error } = await sb.rpc("reschedule_public_appointment", {
      p_public_token: data.token,
      p_staff_id: data.staffId,
      p_starts_at: data.startsAt,
    });
    if (error) {
      await logClientAction(sb, appt, "reschedule", "failed", error.message, { starts_at: data.startsAt });
      throw new Error(translateActionError(error.message));
    }

    const fresh = await loadAppointmentByToken(sb, data.token);
    await logClientAction(sb, fresh ?? appt, "reschedule", "succeeded", "rescheduled", {
      previous_starts_at: appt.starts_at,
      starts_at: fresh?.starts_at ?? data.startsAt,
    });
    await notifyStudioAppointmentAction(sb, fresh ?? appt, "appointment_rescheduled");
    if (fresh?.id) {
      await sendAppointmentLifecycleMessage(sb, fresh.id, "reschedule").catch((error) =>
        console.error("[client-action] reschedule notification failed", error),
      );
      await dispatchPendingStudioPushNotifications({ studioId: fresh.studio_id, appointmentId: fresh.id }).catch((error) =>
        console.error("[client-action] reschedule push failed", error),
      );
    }
    return buildAppointmentPayload(sb, fresh ?? appt);
  });

export const cancelClientAppointment = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(16) }).parse(input))
  .handler(async ({ data }) => {
    const sb = admin();
    const appt = await loadAppointmentByToken(sb, data.token);
    if (!appt) throw new Response("appointment_not_found", { status: 404 });
    const policy = getActionPolicy(appt);
    if (!policy.canCancel) {
      await logClientAction(sb, appt, "cancel", "blocked", policy.blockReason);
      throw new Error(policy.blockReason);
    }

    const { data: cancelledAppointment, error } = await sb
      .from("appointments")
      .update({
        status: "cancelled",
        cancellation_reason: "client_request",
        updated_at: new Date().toISOString(),
      })
      .eq("id", appt.id)
      .eq("status", appt.status)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!cancelledAppointment?.id) {
      throw new Error("A reserva foi atualizada entretanto. Recarregue a página e tente novamente.");
    }

    const fresh = await loadAppointmentByToken(sb, data.token);
    await logClientAction(sb, fresh ?? appt, "cancel", "succeeded", "cancelled");
    await notifyStudioAppointmentAction(sb, fresh ?? appt, "appointment_cancelled");
    if ((fresh ?? appt)?.id) {
      await sendAppointmentLifecycleMessage(sb, (fresh ?? appt).id, "cancellation").catch((error) =>
        console.error("[client-action] cancellation notification failed", error),
      );
      await dispatchPendingStudioPushNotifications({ studioId: (fresh ?? appt).studio_id, appointmentId: (fresh ?? appt).id }).catch((error) =>
        console.error("[client-action] cancellation push failed", error),
      );
    }
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
    if (error) throw new Error("Não foi possível enviar o pedido de reembolso.");
    await dispatchPendingStudioPushNotifications({ studioId: appt.studio_id }).catch(
      (dispatchError) =>
        console.error("[client-action] refund request push failed", dispatchError),
    );
    return { ok: true, refundId: refund?.id ?? null };
  });

async function loadAppointmentByToken(sb: any, token: string) {
  const { data, error } = await sb
    .from("appointments")
    .select(
      "id,public_token,studio_id,staff_id,starts_at,ends_at,created_at,status,total_price,cancellation_reason,clients(name,phone,email),staff(id,name),studios(id,name,slug,logo_url,timezone,whatsapp,phone,cancellation_min_notice_hours,cancellation_after_deadline_policy,refund_requests_enabled,cancellation_policy_text,payment_policy,deposit_percent,studio_policy_settings)",
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
    reservationCode: getPublicReservationCode(appt.public_token ?? appt.id),
    status: appt.status,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    totalPrice: Number(appt.total_price || 0),
    clientName: appt.clients?.name ?? "Cliente",
    clientPhone: appt.clients?.phone ?? "",
    studioName: appt.studios?.name ?? "Estúdio",
    studioSlug: appt.studios?.slug ?? "",
    studioLogoUrl: appt.studios?.logo_url ?? null,
    studioTimezone: appt.studios?.timezone ?? "Europe/Lisbon",
    studioPhone: appt.studios?.whatsapp ?? appt.studios?.phone ?? "",
    staffName: appt.staff?.name ?? "Profissional",
    services: (services ?? []).map((line: any) => ({
      name: line.services?.name ?? "Serviço",
      price: Number(line.price || 0),
      durationMin: Number(line.duration_min || 0),
    })),
    paidAmount: Number(payment?.amount_cents || 0) / 100,
    refundRequest: refund ?? null,
    policy,
    cancellationText: appt.studios?.cancellation_policy_text ?? null,
    depositPercent: appt.studios?.deposit_percent ?? null,
    paymentPolicy: appt.studios?.payment_policy ?? null,
  };
}

function getActionPolicy(appt: any) {
  const cancellation = getStudioBookingActionSetting(
    appt.studios?.studio_policy_settings,
    "cancellation",
  );
  const reschedule = getStudioBookingActionSetting(
    appt.studios?.studio_policy_settings,
    "reschedule",
  );
  return getBookingManageability(
    {
      startsAt: appt.starts_at,
      endsAt: appt.ends_at,
      createdAt: appt.created_at,
      status: appt.status,
    },
    {
      cancellationEnabled: cancellation.enabled,
      rescheduleEnabled: reschedule.enabled,
      cancellationNoticeHours:
        cancellation.noticeHours ?? appt.studios?.cancellation_min_notice_hours,
      rescheduleNoticeHours: reschedule.noticeHours,
      afterDeadlinePolicy: appt.studios?.cancellation_after_deadline_policy,
      refundRequestsEnabled: appt.studios?.refund_requests_enabled,
      paymentPolicy: appt.studios?.payment_policy,
      depositPercent: appt.studios?.deposit_percent,
    },
    appt.studios?.timezone,
  );
}

async function getAppointmentDuration(sb: any, appt: any) {
  const { data } = await sb
    .from("appointment_services")
    .select("duration_min")
    .eq("appointment_id", appt.id);
  const total = (data ?? []).reduce((sum: number, line: any) => sum + Number(line.duration_min || 0), 0);
  if (total > 0) return total;
  const start = Date.parse(appt.starts_at);
  const end = Date.parse(appt.ends_at ?? appt.starts_at);
  return Math.max(15, Math.round((end - start) / 60000) || 15);
}

async function notifyStudioAppointmentAction(sb: any, appt: any, kind: "appointment_rescheduled" | "appointment_cancelled") {
  const clientName = appt.clients?.name ?? "Cliente";
  const when = formatStudioDateTime(appt.starts_at, appt.studios?.timezone);
  const title = kind === "appointment_rescheduled" ? "Marcação remarcada" : "Marcação cancelada";
  const body =
    kind === "appointment_rescheduled"
      ? `${clientName} remarcou a marcação para ${when}.`
      : `${clientName} cancelou a marcação de ${when}.`;
  const rescheduledAt = Math.floor(Date.parse(appt.starts_at) / 1000);
  const eventKey =
    kind === "appointment_rescheduled"
      ? `appointment:${appt.id}:rescheduled:${rescheduledAt}:${appt.staff_id ?? "none"}`
      : `appointment:${appt.id}:cancelled`;
  const { error } = await sb.rpc("insert_studio_notification", {
    p_studio_id: appt.studio_id,
    p_kind: kind,
    p_title: title,
    p_body: body,
    p_payload: {
      appointment_id: appt.id,
      client_id: appt.client_id,
      client_name: clientName,
      starts_at: appt.starts_at,
      event_key: eventKey,
      action_url: "/admin/agenda",
    },
  });
  if (error) {
    console.error("[client-action] studio notification failed", {
      studio_id: appt.studio_id,
      appointment_id: appt.id,
      kind,
      error: error.message,
    });
  }
}

async function logClientAction(
  sb: any,
  appt: any,
  action: "open" | "reschedule_open" | "reschedule" | "cancel_open" | "cancel" | "contact_whatsapp",
  status: "started" | "succeeded" | "failed" | "blocked",
  result: string,
  payload: Record<string, unknown> = {},
) {
  const publicTokenHash = await sha256(String(appt.public_token ?? ""));
  const { error } = await sb.from("client_appointment_action_logs").insert({
    appointment_id: appt.id,
    studio_id: appt.studio_id,
    public_token_hash: publicTokenHash,
    action,
    status,
    result,
    payload,
  });
  if (error) {
    console.error("[client-action] audit log failed", {
      appointment_id: appt.id,
      action,
      status,
      error: error.message,
    });
  }
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function translateActionError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("slot_unavailable")) return "Este horário acabou de ficar indisponível. Escolha outro.";
  if (text.includes("appointment_not_reschedulable")) return "Esta marcação já não pode ser remarcada.";
  if (text.includes("appointment_not_found")) return "Não encontrámos esta marcação.";
  return "Não foi possível concluir a ação. Tente novamente.";
}
