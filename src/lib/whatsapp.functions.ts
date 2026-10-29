import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAppointmentProfessionalDisplayName } from "@/lib/appointment-professionals";
import {
  assertAgendaAppointmentAccess,
  assertStudioAccessWithOptions,
  rateLimitOrThrow,
} from "@/lib/server-security";
import { getPublicReservationCode } from "@/lib/reservation-code";
import {
  AraraSendError,
  buildAraraBookingTemplate,
  getAraraMessageStatus,
  sendAraraBookingTemplate,
  type AraraBookingDetails,
  type AraraBookingKind,
} from "@/lib/arara-whatsapp";
import {
  SENDDM_BOOKING_CONFIRMATION_PARAMETERS,
  buildSendDmWhatsAppPayload,
  classifySendDmWhatsAppDelivery,
  readSendDmChannel,
  readSendDmError,
  readSendDmMessageId,
  readSendDmStatus,
  sendDmExplicitRetryKey,
  readUnresolvedSendDmButtonVariable,
  validateSendDmTemplateParameters,
  type SendDmTemplateParameters,
} from "@/lib/senddm-whatsapp";
import {
  SENDDM_LIFECYCLE_PARAMETERS,
  SENDDM_LIFECYCLE_TEMPLATES,
  buildSendDmLifecycleParameters,
  isSendDmLifecycleKind,
} from "@/lib/senddm-booking-lifecycle";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { formatStudioDate, formatStudioDateTime, formatStudioTime } from "@/lib/studio-time";
import {
  appointmentConfirmationIdempotencyKey,
  shouldSendAutomaticManualAppointmentConfirmation,
} from "@/lib/appointment-whatsapp-policy";

const DEFAULT_TEMPLATE =
  "Ola, {nomeCliente}. Confirmamos a sua marcacao de {servico} com {profissional} para {data} as {hora}.";

const WHATSAPP_PROVIDER = "senddm_whatsapp";
const ARARA_PROVIDER = "arara_whatsapp";
const SENDDM_TEMPLATE_INTERNAL_NAME = "Marca\u00e7\u00e3o";
const SENDDM_TEMPLATE_MODEL_ID = "aca219e7-63cb-4eea-a8fd-9aee187e8676";
const SENDDM_TEMPLATE_APPROVED_NAME = "new_template__hkmlmqkyap";
const SENDDM_WHATSAPP_TEMPLATE_ID = "1772571720773309";
const EMAIL_PROVIDER = "resend_email";
type WhatsAppSendInput = {
  studioId: string;
  to: string;
  body: string;
  reservationUrl: string;
  orderId: string;
  appointmentId?: string | null;
  templateVariables: WhatsAppTemplateVariables;
  bookingDetails: AraraBookingDetails;
  messageKind?: ConfirmationContext["messageKind"];
  idempotencyKey: string;
};

type WhatsAppSendResult = {
  provider: string;
  messageId: string | null;
  deliveryStatus: string | null;
  payload: unknown;
};

type WhatsAppProvider = {
  name: string;
  sendText(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
};

type EmailSendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
};

type EmailSendResult = {
  provider: string;
  messageId: string | null;
  payload: unknown;
};

type EmailProvider = {
  name: string;
  send(input: EmailSendInput): Promise<EmailSendResult>;
};

type WhatsAppTemplateVariables = {
  nomeCliente: string;
  data: string;
  hora: string;
  servico: string;
  profissional: string;
  orderId: string;
};

type ConfirmationContext = {
  studioId: string;
  studioName: string;
  appointmentId: string | null;
  paymentRowId: string;
  paymentIntentId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
  serviceName: string;
  staffName: string;
  startsAt: string;
  studioTimezone: string;
  paidAmount: number;
  currency: string;
  template: string;
  autoEnabled: boolean;
  bookingUrl: string;
  messageKind?: "confirmation" | "reschedule" | "cancellation" | "reminder_2h";
};

function admin(): any {
  return getAdminClient();
}

export const getWhatsAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertStudioAccessWithOptions(sb, (context as any).userId, data.studioId, {
      entitlement: "whatsapp",
    });
    const studio = await loadStudioWhatsApp(sb, data.studioId);
    return normalizeWhatsAppStudio(studio);
  });

export const saveWhatsAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        studioId: z.string().uuid(),
        autoSendEnabled: z.boolean().optional(),
        messageTemplate: z.string().min(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertStudioAccessWithOptions(sb, (context as any).userId, data.studioId, {
      entitlement: "whatsapp",
    });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof data.autoSendEnabled === "boolean") {
      patch.whatsapp_auto_send_enabled = data.autoSendEnabled;
    }
    if (data.messageTemplate) patch.whatsapp_default_message = data.messageTemplate;
    const { error } = await sb.from("studios").update(patch).eq("id", data.studioId);
    if (isMissingWhatsAppSchema(error)) {
      throw new Error(
        "A funcionalidade de WhatsApp não está disponível neste momento. Contacte o suporte Bellza.",
      );
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testWhatsAppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ studioId: z.string().uuid(), phone: z.string().min(6) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId;
    await assertStudioAccessWithOptions(sb, userId, data.studioId, {
      entitlement: "whatsapp",
    });
    await rateLimitOrThrow({
      key: `whatsapp-test:${userId}:${data.studioId}`,
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });
    const studio = await loadStudioWhatsApp(sb, data.studioId);
    const to = normalizeWhatsAppPhone(data.phone);
    if (!to) throw new Error("Telefone invalido para WhatsApp.");

    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const testAppointment = await loadLatestAppointmentForStudio(sb, data.studioId, to);
    const mode = (await getServerEnv("ARARA_WHATSAPP_MODE")).toLowerCase();
    const canaryPhone = normalizeWhatsAppPhone(await getServerEnv("ARARA_CANARY_PHONE"));
    const testArara = mode === "on" || (mode === "canary" && canaryPhone === to);
    const realContext = testArara
      ? await loadAppointmentConfirmationContext(sb, testAppointment.id)
      : null;
    if (testArara && (!realContext || normalizeWhatsAppPhone(realContext.clientPhone) !== to)) {
      throw new Error("arara_test_appointment_data_missing");
    }
    const ctx: ConfirmationContext = realContext ? {
      ...realContext,
      messageKind: "confirmation",
    } : {
      studioId: studio.id,
      studioName: studio.name ?? "Estúdio",
      appointmentId: null,
      paymentRowId: "test",
      paymentIntentId: "test",
      clientName: "Cliente teste",
      clientPhone: to,
      clientEmail: null,
      serviceName: "Serviço teste",
      staffName: "Profissional",
      startsAt,
      studioTimezone: studio.timezone ?? "Europe/Lisbon",
      paidAmount: 10,
      currency: "eur",
      template: studio.whatsapp_default_message ?? DEFAULT_TEMPLATE,
      autoEnabled: true,
      bookingUrl: testAppointment.url,
    };
    const result = await sendConfirmationFromContext(
      sb,
      ctx,
      `senddm-whatsapp-test-${data.studioId}-${Date.now()}`,
      { skipEmail: true },
    );
    return {
      ok: result?.status === "sent" || result?.status === "pending",
      messageId: result?.provider_message_id ?? null,
      deliveryStatus: result?.status ?? null,
      delivered: result?.status === "sent",
    };
  });

export async function sendAppointmentConfirmationMessage(
  sb: any,
  input: { stripePaymentIntentId?: string; paymentIntentId?: string },
) {
  const ctx = await loadConfirmationContext(sb, input);
  if (!ctx) return null;

  const idempotencyKey = appointmentConfirmationIdempotencyKey(
    ctx.appointmentId,
    `senddm-whatsapp-payment-${ctx.paymentRowId}`,
  );
  return sendConfirmationFromContext(sb, ctx, idempotencyKey);
}

export const sendAppointmentConfirmationForAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appointmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertAgendaAppointmentAccess(sb, (context as any).userId, data.appointmentId, {
      entitlement: "whatsapp",
    });
    const ctx = await loadAppointmentConfirmationContext(sb, data.appointmentId);
    if (!ctx) return null;
    return sendConfirmationFromContext(
      sb,
      ctx,
      appointmentConfirmationIdempotencyKey(
        data.appointmentId,
        `senddm-whatsapp-appointment-${data.appointmentId}`,
      ),
      { explicitRetry: true },
    );
  });

export const sendManualAppointmentConfirmationForAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appointmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertAgendaAppointmentAccess(sb, (context as any).userId, data.appointmentId, {
      entitlement: "whatsapp",
    });

    const { data: appointment, error } = await sb
      .from("appointments")
      .select("id,status")
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (error || !appointment?.id) {
      return { ok: false, skipped: "appointment_missing" };
    }
    if (!shouldSendAutomaticManualAppointmentConfirmation(appointment.status)) {
      console.info("[whatsapp] manual_confirmation_skipped", {
        appointment_id: data.appointmentId,
        status: appointment.status,
        reason: "non_scheduled_appointment",
      });
      return { ok: false, skipped: "non_scheduled_appointment" };
    }

    const ctx = await loadAppointmentConfirmationContext(sb, data.appointmentId);
    if (!ctx) return { ok: false, skipped: "confirmation_context_missing" };
    const result = await sendConfirmationFromContext(
      sb,
      ctx,
      appointmentConfirmationIdempotencyKey(
        data.appointmentId,
        `senddm-whatsapp-manual-appointment-${data.appointmentId}`,
      ),
    );
    return {
      ok: Boolean(result),
      status: result?.status ?? null,
      messageId: result?.provider_message_id ?? null,
    };
  });

export const sendPublicAppointmentConfirmationForAppointment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ studioId: z.string().uuid(), appointmentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = admin();
    const appointment = await loadRecentPublicAppointment(sb, data.studioId, data.appointmentId);
    if (!appointment) {
      console.info("[whatsapp] public_confirmation_skipped", {
        studio_id: data.studioId,
        appointment_id: data.appointmentId,
        reason: "appointment_missing_or_old",
      });
      return { ok: false, skipped: "appointment_missing_or_old" };
    }
    console.info("[whatsapp] public_confirmation_attempt", {
      studio_id: data.studioId,
      appointment_id: data.appointmentId,
    });
    const ctx = await loadAppointmentConfirmationContext(sb, data.appointmentId);
    if (!ctx) return { ok: false, skipped: "confirmation_context_missing" };
    const result = await sendConfirmationFromContext(
      sb,
      ctx,
      appointmentConfirmationIdempotencyKey(
        data.appointmentId,
        `senddm-whatsapp-public-appointment-${data.appointmentId}`,
      ),
    );
    return {
      ok: Boolean(result),
      status: result?.status ?? null,
      messageId: result?.provider_message_id ?? null,
    };
  });

export async function sendAppointmentLifecycleMessage(
  sb: any,
  appointmentId: string,
  kind: "reschedule" | "cancellation",
) {
  const ctx = await loadAppointmentConfirmationContext(sb, appointmentId);
  if (!ctx) return null;
  const template =
    kind === "reschedule"
      ? "Ola, {nomeCliente}. A sua marcacao de {servico} com {profissional} foi remarcada para {data} as {hora}."
      : "Ola, {nomeCliente}. A sua marcacao de {servico} com {profissional} para {data} as {hora} foi cancelada.";
  return sendConfirmationFromContext(
    sb,
    { ...ctx, template, messageKind: kind },
    `senddm-whatsapp-${kind}-appointment-${appointmentId}-${Date.parse(ctx.startsAt) || Date.now()}`,
  );
}

async function sendConfirmationFromContext(
  sb: any,
  ctx: ConfirmationContext,
  idempotencyKey: string,
  options: { explicitRetry?: boolean; skipEmail?: boolean; recoveryAttempt?: boolean } = {},
) {
  const [notificationsEnabled, whatsappEnabled] = await Promise.all([
    hasStudioEntitlement(sb, ctx.studioId, "notifications"),
    hasStudioEntitlement(sb, ctx.studioId, "whatsapp"),
  ]);
  const existing =
    (await findExistingLog(sb, idempotencyKey)) ??
    (ctx.messageKind ? null : await findExistingConfirmationLog(sb, ctx));
  const rendered = renderMessage(ctx.template || DEFAULT_TEMPLATE, ctx);
  const emailPromise = notificationsEnabled && !options.skipEmail
    ? sendEmailConfirmationFromContext(
        sb,
        ctx,
        rendered,
        `email-${idempotencyKey}`,
      ).catch((error) => {
        console.error("[email] confirmation failed", {
          idempotency_key: `email-${idempotencyKey}`,
          studio_id: ctx.studioId,
          appointment_id: ctx.appointmentId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      })
    : Promise.resolve(null);

  if (!whatsappEnabled) {
    await emailPromise;
    return null;
  }
  if (
    existing?.status === "sent" ||
    (existing?.provider === ARARA_PROVIDER &&
      (existing?.provider_message_id || existing?.reason === "arara_acceptance_unknown") &&
      !(existing.status === "failed" && existing.reason === "arara_delivery_failed")) ||
    (existing?.status === "pending" && !isStalePendingWhatsAppLog(existing))
  ) {
    await emailPromise;
    return existing;
  }
  if (existing?.status === "pending") {
    console.warn("[whatsapp] retrying stale pending confirmation", {
      idempotency_key: idempotencyKey,
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      created_at: existing.created_at,
    });
  }

  const recipient = normalizeWhatsAppPhone(ctx.clientPhone);
  const providerIdempotencyKey = options.explicitRetry
    ? sendDmExplicitRetryKey(idempotencyKey, existing, recipient)
    : idempotencyKey;

  if (!ctx.autoEnabled) {
    console.warn("[whatsapp] skipped — auto_send_disabled", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
    });
    const log = await insertLog(sb, ctx, idempotencyKey, {
      status: "skipped",
      reason: "auto_send_disabled",
      message: rendered,
      recipientPhone: recipient,
      provider: WHATSAPP_PROVIDER,
    });
    await emailPromise;
    return log;
  }
  if (!recipient) {
    console.warn("[whatsapp] skipped — invalid_phone", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      phone: maskPhoneForLog(ctx.clientPhone),
    });
    const log = await insertLog(sb, ctx, idempotencyKey, {
      status: "skipped",
      reason: "invalid_phone",
      message: rendered,
      recipientPhone: ctx.clientPhone || null,
      provider: WHATSAPP_PROVIDER,
    });
    await emailPromise;
    return log;
  }

  const usageReservation = await reserveWhatsAppUsage(sb, {
    studioId: ctx.studioId,
    idempotencyKey,
    messageKind: ctx.messageKind ?? "confirmation",
  });
  if (!usageReservation.allowed) {
    console.warn("[whatsapp] skipped by commercial policy", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      reason: usageReservation.reason,
      used: usageReservation.used ?? null,
      limit: usageReservation.limit ?? null,
    });
    const log = await insertLog(sb, ctx, idempotencyKey, {
      status: "skipped",
      reason: usageReservation.reason,
      message: rendered,
      recipientPhone: recipient,
      provider: WHATSAPP_PROVIDER,
    });
    await emailPromise;
    return log;
  }

  const pending =
    existing ??
    (await insertLog(sb, ctx, idempotencyKey, {
      status: "pending",
      reason: null,
      message: rendered,
      recipientPhone: recipient,
      provider: WHATSAPP_PROVIDER,
    }));
  if (!pending) {
    await emailPromise;
    return findExistingLog(sb, idempotencyKey);
  }
  const recoveryAttempts = Number(existing?.payload?.recovery_attempts || 0) +
    (options.recoveryAttempt ? 1 : 0);
  if (existing) {
    await updateLog(sb, existing.id, {
      status: "pending",
      reason: null,
      message: rendered,
      recipient_phone: recipient,
      provider: WHATSAPP_PROVIDER,
      provider_message_id: null,
      payload: {
        retry_from_status: existing.status,
        recovery_attempts: recoveryAttempts,
        payment_intent_id: ctx.paymentIntentId,
        service: ctx.serviceName,
        staff: ctx.staffName,
        booking_url: ctx.bookingUrl,
      },
    });
  }

  try {
    const sent = await getWhatsAppProvider().sendText({
      studioId: ctx.studioId,
      to: recipient,
      body: rendered,
      reservationUrl: ctx.bookingUrl,
      orderId: publicOrderIdFromUrl(ctx.bookingUrl),
      appointmentId: ctx.appointmentId,
      templateVariables: buildTemplateVariables(ctx),
      bookingDetails: {
        clientName: ctx.clientName,
        studioName: ctx.studioName,
        serviceName: ctx.serviceName,
        date: formatStudioDate(ctx.startsAt, ctx.studioTimezone),
        time: formatStudioTime(ctx.startsAt, ctx.studioTimezone),
        reservationUrl: ctx.bookingUrl,
      },
      messageKind: ctx.messageKind ?? "confirmation",
      // A new key is used only for an explicit resend after a verified terminal
      // failure with BUSINESS_017 or a corrected recipient. Unknown outcomes
      // retain the original key.
      idempotencyKey: providerIdempotencyKey,
    });
    console.info("[whatsapp] sent", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      message_id: sent.messageId,
      delivery_status: sent.deliveryStatus,
      to: maskPhoneForLog(recipient),
    });
    const delivered = ["DELIVERED", "READ"].includes(String(sent.deliveryStatus || "").toUpperCase());
    const log = await updateLog(sb, pending.id, {
      status: delivered ? "sent" : "pending",
      reason: delivered
        ? null
        : `${sent.provider === ARARA_PROVIDER ? "arara" : "senddm"}_awaiting_delivery:${String(sent.deliveryStatus || "UNKNOWN").toUpperCase()}`,
      provider: sent.provider,
      provider_message_id: sent.messageId,
      payload: sent.payload,
    });
    await finalizeWhatsAppUsage(sb, {
      idempotencyKey,
      outcome: delivered ? "delivered" : "submitted",
      messageLogId: pending.id,
      providerMessageId: sent.messageId,
      providerStatus: sent.deliveryStatus,
    });
    await emailPromise;
    return log;
  } catch (error) {
    const providerError = error instanceof WhatsAppDeliveryError ? error : null;
    const reason = error instanceof Error ? error.message : "whatsapp_send_failed";
    const acceptanceUnknown = (providerError?.payload as any)?.acceptanceUnknown === true;
    console.error("[whatsapp] send failed", {
      idempotency_key: idempotencyKey,
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      reason,
      provider_message_id: providerError?.messageId ?? null,
    });
    const log = await updateLog(sb, pending.id, {
      status: acceptanceUnknown ? "pending" : "failed",
      reason,
      provider: (providerError?.payload as any)?.provider === ARARA_PROVIDER ? ARARA_PROVIDER : WHATSAPP_PROVIDER,
      provider_message_id: providerError?.messageId ?? null,
      payload: {
        ...(providerError?.payload ?? { error: reason }),
        recovery_attempts: recoveryAttempts,
      },
    });
    await finalizeWhatsAppUsage(sb, {
      idempotencyKey,
      outcome: acceptanceUnknown ? "submitted" : "failed",
      messageLogId: pending.id,
      providerMessageId: providerError?.messageId ?? null,
      providerStatus: acceptanceUnknown ? "UNKNOWN" : "FAILED",
      metadata: { reason },
    });
    await emailPromise;
    return log;
  }
}

export async function dispatchDueAraraTwoHourReminders() {
  const mode = (await getServerEnv("ARARA_WHATSAPP_MODE")).toLowerCase();
  const canaryPhone = normalizeWhatsAppPhone(await getServerEnv("ARARA_CANARY_PHONE"));

  const sb = admin();
  const now = Date.now();
  const { data, error } = await sb
    .from("appointments")
    .select("id,studio_id,starts_at,clients:clients!appointments_client_same_studio(phone)")
    .eq("status", "confirmed")
    .gte("starts_at", new Date(now + 15 * 60 * 1000).toISOString())
    .lt("starts_at", new Date(now + 120 * 60 * 1000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 500) console.warn("[whatsapp] reminder scan reached 500 appointment cap");

  const due = (data ?? []).filter((row: any) => Number.isFinite(Date.parse(row.starts_at)));
  const keys = due.map((row: any) => `arara-reminder-2h-${row.id}-${Date.parse(row.starts_at)}`);
  const { data: priorLogs, error: logsError } = keys.length
    ? await sb.from("whatsapp_message_logs").select("idempotency_key,status").in("idempotency_key", keys)
    : { data: [], error: null };
  if (logsError) throw new Error(logsError.message);
  const alreadyHandled = new Set((priorLogs ?? [])
    .filter((row: any) => row.status === "sent" || row.status === "pending")
    .map((row: any) => row.idempotency_key));

  let dispatched = 0;
  for (const row of due) {
    const startsAt = Date.parse(row.starts_at);
    const idempotencyKey = `arara-reminder-2h-${row.id}-${startsAt}`;
    if (alreadyHandled.has(idempotencyKey)) continue;
    const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    const ctx = await loadAppointmentConfirmationContext(sb, row.id);
    if (!ctx?.autoEnabled || Date.parse(ctx.startsAt) !== startsAt) continue;
    const araraRecipient = mode === "on" ||
      (mode === "canary" && Boolean(canaryPhone) && normalizeWhatsAppPhone(client?.phone) === canaryPhone);
    if (araraRecipient && formatStudioDate(new Date(now).toISOString(), ctx.studioTimezone) !==
      formatStudioDate(ctx.startsAt, ctx.studioTimezone)) continue;
    const result = await sendConfirmationFromContext(
      sb,
      {
        ...ctx,
        messageKind: "reminder_2h",
        template: "Olá, {nomeCliente}. A sua marcação em {nome_estudio} para {servico} é hoje, {data}, às {hora}. Esperamos por si dentro de duas horas.",
      },
      idempotencyKey,
      { skipEmail: true },
    );
    if (result?.status === "sent" || result?.status === "pending") dispatched += 1;
  }
  return { checked: (data ?? []).length, dispatched };
}

async function hasStudioEntitlement(sb: any, studioId: string, feature: string) {
  const { data, error } = await sb.rpc("studio_has_entitlement", {
    _studio_id: studioId,
    _feature: feature,
  });
  if (error) {
    console.error("[plans] notification_entitlement_check_failed", {
      studio_id: studioId,
      feature,
      reason: error.message,
    });
    return false;
  }
  return data === true;
}

type WhatsAppUsageReservation = {
  allowed: boolean;
  reason: string;
  ledgerId?: string;
  used?: number | null;
  limit?: number | null;
};

async function reserveWhatsAppUsage(
  sb: any,
  input: { studioId: string; idempotencyKey: string; messageKind: string },
): Promise<WhatsAppUsageReservation> {
  const { data, error } = await sb.rpc("reserve_whatsapp_usage", {
    p_studio_id: input.studioId,
    p_idempotency_key: input.idempotencyKey,
    p_message_kind: input.messageKind,
  });
  if (error) {
    if (isMissingWhatsAppCommercialSchema(error)) {
      console.warn("[whatsapp] commercial controls unavailable; preserving legacy access", {
        studio_id: input.studioId,
        reason: error.message,
      });
      return { allowed: true, reason: "legacy_schema_fallback" };
    }
    throw new Error(`whatsapp_usage_reservation_failed:${error.message}`);
  }
  return {
    allowed: Boolean(data?.allowed),
    reason: String(data?.reason || "whatsapp_usage_denied"),
    ledgerId: data?.ledgerId,
    used: data?.used,
    limit: data?.limit,
  };
}

async function finalizeWhatsAppUsage(
  sb: any,
  input: {
    idempotencyKey: string;
    outcome: "submitted" | "delivered" | "failed" | "skipped";
    messageLogId?: string | null;
    providerMessageId?: string | null;
    providerStatus?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await sb.rpc("finalize_whatsapp_usage", {
    p_idempotency_key: input.idempotencyKey,
    p_outcome: input.outcome,
    p_message_log_id: input.messageLogId ?? null,
    p_provider_message_id: input.providerMessageId ?? null,
    p_provider_status: input.providerStatus ?? null,
    p_metadata: input.metadata ?? {},
  });
  if (error && !isMissingWhatsAppCommercialSchema(error)) {
    console.error("[whatsapp] usage finalization failed", {
      idempotency_key: input.idempotencyKey,
      outcome: input.outcome,
      reason: error.message,
    });
  }
}

function isMissingWhatsAppCommercialSchema(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    message.includes("reserve_whatsapp_usage") ||
    message.includes("finalize_whatsapp_usage") ||
    message.includes("schema cache")
  );
}

function getWhatsAppProvider(): WhatsAppProvider {
  return new HybridWhatsAppService();
}

class HybridWhatsAppService implements WhatsAppProvider {
  name = "hybrid_whatsapp";

  async sendText(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    const mode = (await getServerEnv("ARARA_WHATSAPP_MODE")).toLowerCase();
    const canaryPhone = normalizeWhatsAppPhone(await getServerEnv("ARARA_CANARY_PHONE"));
    const enabled = mode === "on" || (mode === "canary" && canaryPhone === input.to);
    const kind = input.messageKind ?? "confirmation";
    if (!enabled || kind === "reschedule" || !input.appointmentId) {
      return new SendDmService().sendText(input);
    }

    try {
      const araraKind = kind as AraraBookingKind;
      const key = await getServerEnv("ARARA_API_KEY");
      const verifiedDetails = await loadVerifiedAraraBookingDetails(input);
      const request = buildAraraBookingTemplate(araraKind, verifiedDetails);
      const sent = await sendAraraBookingTemplate({
        apiKey: key,
        receiver: input.to,
        kind: araraKind,
        details: verifiedDetails,
        idempotencyKey: `arara-${input.idempotencyKey}`,
      });
      let status = sent.status;
      for (let check = 0; check < 3 && !["DELIVERED", "READ", "FAILED", "CANCELED", "CANCELLED"].includes(status); check += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        try {
          status = await getAraraMessageStatus({ apiKey: key, messageId: sent.messageId });
        } catch {
          break;
        }
      }
      if (["FAILED", "CANCELED", "CANCELLED"].includes(status)) {
        throw new AraraSendError(`arara_delivery_${status.toLowerCase()}`, false, sent.messageId);
      }
      return {
        provider: ARARA_PROVIDER,
        messageId: sent.messageId,
        deliveryStatus: status === "READ" ? "DELIVERED" : status,
        payload: { templateName: request.templateName, status, provider: ARARA_PROVIDER },
      };
    } catch (error) {
      if (kind === "confirmation" && error instanceof AraraSendError && error.safeToFallback) {
        console.warn("[whatsapp] Arara rejected confirmation before acceptance; using Sent.dm", {
          appointment_id: input.appointmentId,
          reason: error.message,
        });
        const fallback = await new SendDmService().sendText({
          ...input,
          idempotencyKey: `${input.idempotencyKey}-sentdm-fallback`,
        });
        return {
          ...fallback,
          payload: { fallbackReason: error.message, fallback: fallback.payload },
        };
      }
      const reason = error instanceof Error ? error.message : "arara_send_failed";
      throw new WhatsAppDeliveryError({
        message: reason,
        messageId: error instanceof AraraSendError ? error.messageId : null,
        payload: { provider: ARARA_PROVIDER, reason, acceptanceUnknown: error instanceof AraraSendError && error.acceptanceUnknown },
        retryable: false,
      });
    }
  }
}

async function loadVerifiedAraraBookingDetails(input: WhatsAppSendInput): Promise<AraraBookingDetails> {
  const sb = admin();
  const { data: appointment, error } = await sb
    .from("appointments")
    .select("id,studio_id,client_id,starts_at,public_token,status")
    .eq("id", input.appointmentId)
    .eq("studio_id", input.studioId)
    .maybeSingle();
  if (error || !appointment?.id || !appointment.public_token || !appointment.client_id) {
    throw new AraraSendError("arara_appointment_missing", false);
  }
  const kind = input.messageKind ?? "confirmation";
  if ((kind === "confirmation" || kind === "reminder_2h") && appointment.status !== "confirmed") {
    throw new AraraSendError("arara_appointment_not_confirmed", false);
  }
  if (kind === "cancellation" && appointment.status !== "cancelled") {
    throw new AraraSendError("arara_appointment_not_cancelled", false);
  }
  const [{ data: client }, { data: studio }, { data: lines }] = await Promise.all([
    sb.from("clients").select("name,phone").eq("id", appointment.client_id).eq("studio_id", input.studioId).maybeSingle(),
    sb.from("studios").select("name,timezone").eq("id", input.studioId).maybeSingle(),
    sb.from("appointment_services").select("services(name)").eq("appointment_id", appointment.id),
  ]);
  const verified: AraraBookingDetails = {
    clientName: String(client?.name ?? "").trim(),
    studioName: String(studio?.name ?? "").trim(),
    serviceName: joinServiceNames(lines),
    date: formatStudioDate(appointment.starts_at, studio?.timezone),
    time: formatStudioTime(appointment.starts_at, studio?.timezone),
    reservationUrl: `https://bellza.pt/r/${appointment.public_token}`,
  };
  if (normalizeWhatsAppPhone(client?.phone) !== input.to ||
    Object.entries(verified).some(([key, value]) => value !== input.bookingDetails[key as keyof AraraBookingDetails])) {
    throw new AraraSendError("arara_appointment_data_mismatch", false);
  }
  return verified;
}

function getEmailProvider(): EmailProvider {
  return new ResendEmailService();
}

class SendDmService implements WhatsAppProvider {
  name = WHATSAPP_PROVIDER;

  async sendText(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    const apiKey = input.messageKind && isSendDmLifecycleKind(input.messageKind)
      ? await getServerEnv("SENDDM_API_KEY")
      : (await getServerEnv("SENDDM_CONFIRMATION_API_KEY")) ||
        (await getServerEnv("SENDDM_API_KEY"));
    const lifecycleTemplate = input.messageKind && isSendDmLifecycleKind(input.messageKind)
      ? SENDDM_LIFECYCLE_TEMPLATES[input.messageKind]
      : null;
    const modelId = lifecycleTemplate?.id ??
      ((await getServerEnv("SENDDM_MODEL_ID")) || SENDDM_TEMPLATE_MODEL_ID);
    const whatsappTemplateId = lifecycleTemplate ? null :
      (await getServerEnv("SENDDM_WHATSAPP_TEMPLATE_ID")) || SENDDM_WHATSAPP_TEMPLATE_ID;
    const baseUrl = ((await getServerEnv("SENDDM_API_BASE_URL")) || "https://api.sent.dm").replace(
      /\/$/,
      "",
    );
    const language = (await getServerEnv("SENDDM_WHATSAPP_TEMPLATE_LANGUAGE")) || "pt_BR";
    const templateName = lifecycleTemplate?.name ??
      ((await getServerEnv("SENDDM_WHATSAPP_TEMPLATE_NAME")) || SENDDM_TEMPLATE_APPROVED_NAME);
    const internalTemplate = lifecycleTemplate?.title ??
      ((await getServerEnv("SENDDM_TEMPLATE_INTERNAL_NAME")) || SENDDM_TEMPLATE_INTERNAL_NAME);

    if (!apiKey) throw new Error("SENDDM_API_KEY em falta.");
    if (!modelId) throw new Error("SENDDM_MODEL_ID em falta.");

    const templateParameters = lifecycleTemplate
      ? buildSendDmLifecycleParameters({
          nomeCliente: input.templateVariables.nomeCliente,
          data: input.templateVariables.data,
          hora: input.templateVariables.hora,
          servico: input.templateVariables.servico,
          profissional: input.templateVariables.profissional,
        }, input.reservationUrl)
      : buildSendDmTemplateParameterObject(input.templateVariables);
    const expectedParameters = lifecycleTemplate
      ? SENDDM_LIFECYCLE_PARAMETERS
      : SENDDM_BOOKING_CONFIRMATION_PARAMETERS;
    const validation = validateSendDmTemplateParameters(
      expectedParameters,
      templateParameters,
    );
    const payload = buildSendDmWhatsAppPayload({
      to: input.to,
      templateId: modelId,
      parameters: templateParameters,
      metadata: {
        source: "bellza",
        modelId,
        whatsappTemplateId: whatsappTemplateId || undefined,
        internalTemplate,
        approvedTemplate: templateName,
        messageKind: input.messageKind ?? "confirmation",
        appointmentId: input.appointmentId ?? undefined,
        orderId: input.orderId,
        reservationCode: getPublicReservationCode(input.orderId),
        reservationUrl: input.reservationUrl,
      },
    });
    const requestLogPayload = sanitizeSendDmRequestPayload(payload);
    const templateAudit = {
      template_id: modelId,
      template_name: internalTemplate,
      approved_template: templateName,
      whatsapp_template_id: whatsappTemplateId || null,
      language,
      message_kind: input.messageKind ?? "confirmation",
      expected_parameter_count: expectedParameters.length,
      sent_parameter_count: Object.keys(templateParameters).length,
      expected_parameters: [...expectedParameters],
      parameter_state: validation.parameterState,
    };
    console.info("[whatsapp] senddm_request", {
      payload: requestLogPayload,
      ...templateAudit,
      recipient: maskPhoneForLog(input.to),
      appointment_id: input.appointmentId ?? null,
      order_id: input.orderId,
      reservation_url: input.reservationUrl,
    });

    if (!validation.ok) {
      console.error("[whatsapp] senddm_parameter_mismatch", {
        ...templateAudit,
        reason: validation.reason,
        payload: requestLogPayload,
      });
      throw new WhatsAppDeliveryError({
        message: `senddm_template_parameter_mismatch: ${validation.reason}`,
        messageId: null,
        payload: {
          request: requestLogPayload,
          validation: {
            reason: validation.reason,
            expectedParameterCount: expectedParameters.length,
            sentParameterCount: Object.keys(templateParameters).length,
            expectedParameters: [...expectedParameters],
            parameterState: validation.parameterState,
          },
        },
        retryable: false,
      });
    }

    return sendWithRetry(async () => {
      const response = await fetch(`${baseUrl}/v3/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Idempotency-Key": input.idempotencyKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const responsePayload = await response.json().catch(() => null);
      console.info("[whatsapp] senddm_response", {
        ok: response.ok,
        status: response.status,
        template_name: internalTemplate,
        approved_template: templateName,
        whatsapp_template_id: whatsappTemplateId || null,
        recipient: maskPhoneForLog(input.to),
        appointment_id: input.appointmentId ?? null,
        order_id: input.orderId,
        message_id: readSendDmMessageId(responsePayload),
        delivery_status: readSendDmStatus(responsePayload),
        delivery_channel: readSendDmChannel(responsePayload),
        error: response.ok ? null : readSendDmError(responsePayload),
      });
      if (!response.ok) {
        const detail = readSendDmError(responsePayload) || response.statusText;
        throw new WhatsAppDeliveryError({
          message: `senddm_http_${response.status}: ${detail}`,
          messageId: readSendDmMessageId(responsePayload),
          payload: {
            request: requestLogPayload,
            response: responsePayload ?? { status: response.status, detail },
          },
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      const acceptedChannel = readSendDmChannel(responsePayload);
      if (acceptedChannel && acceptedChannel !== "whatsapp") {
        throw new WhatsAppDeliveryError({
          message: `senddm_channel_mismatch: expected_whatsapp_received_${acceptedChannel}`,
          messageId: readSendDmMessageId(responsePayload),
          payload: {
            request: requestLogPayload,
            response: responsePayload,
          },
          retryable: false,
        });
      }

      const messageId = readSendDmMessageId(responsePayload);
      if (!messageId) {
        throw new WhatsAppDeliveryError({
          message: "senddm_response_missing_message_id",
          messageId: null,
          payload: {
            request: requestLogPayload,
            response: responsePayload,
          },
          retryable: false,
        });
      }
      const finalPayload = messageId
        ? await refreshSendDmMessageStatus(baseUrl, apiKey, messageId, responsePayload)
        : responsePayload;
      const classification = classifySendDmWhatsAppDelivery(finalPayload);
      const finalStatus = classification.status;
      const finalChannel = classification.channel;
      const contactDiagnostics =
        classification.state === "failed"
          ? await loadSendDmContactDiagnostics(baseUrl, apiKey, finalPayload)
          : null;
      console.info("[whatsapp] senddm_final_status", {
        template_name: internalTemplate,
        approved_template: templateName,
        whatsapp_template_id: whatsappTemplateId || null,
        recipient: maskPhoneForLog(input.to),
        appointment_id: input.appointmentId ?? null,
        order_id: input.orderId,
        message_id: messageId,
        delivery_status: finalStatus,
        delivery_channel: finalChannel,
        error: classification.reason || readSendDmWhatsAppChannelError(contactDiagnostics) || null,
        contact: contactDiagnostics,
        payload: {
          request: requestLogPayload,
          response: finalPayload,
        },
      });
      if (classification.state === "failed") {
        const channelError = readSendDmWhatsAppChannelError(contactDiagnostics);
        throw new WhatsAppDeliveryError({
          message:
            channelError || classification.reason || "senddm_delivery_failed: provider_failed",
          messageId,
          payload: {
            request: requestLogPayload,
            response: finalPayload,
            contact: contactDiagnostics,
          },
          retryable: false,
        });
      }

      return {
        provider: WHATSAPP_PROVIDER,
        messageId,
        deliveryStatus: finalStatus,
        payload: {
          request: requestLogPayload,
          response: finalPayload ?? responsePayload,
        },
      };
    });
  }
}

class EmailDeliveryError extends Error {
  messageId: string | null;
  payload: unknown;
  retryable: boolean;

  constructor(input: {
    message: string;
    messageId: string | null;
    payload: unknown;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "EmailDeliveryError";
    this.messageId = input.messageId;
    this.payload = input.payload;
    this.retryable = Boolean(input.retryable);
  }
}

class ResendEmailService implements EmailProvider {
  name = EMAIL_PROVIDER;

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const apiKey = await getServerEnv("RESEND_API_KEY");
    const from = (await getServerEnv("EMAIL_FROM")) || "Bellza <notificacoes@bellza.pt>";
    const baseUrl = (
      (await getServerEnv("RESEND_API_BASE_URL")) || "https://api.resend.com"
    ).replace(/\/$/, "");
    if (!apiKey) throw new Error("RESEND_API_KEY em falta.");

    const payload = {
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      headers: {
        "X-Entity-Ref-ID": crypto.randomUUID(),
      },
    };
    const requestLogPayload = sanitizeEmailRequestPayload(payload);
    console.info("[email] resend_request", {
      payload: requestLogPayload,
      subject: input.subject,
      to: maskEmail(input.to),
    });

    const response = await fetch(`${baseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responsePayload = await response.json().catch(() => null);
    console.info("[email] resend_response", {
      ok: response.ok,
      status: response.status,
      message_id: readEmailProviderMessageId(responsePayload),
      error: response.ok ? null : readEmailProviderError(responsePayload),
    });
    if (!response.ok) {
      const detail = readEmailProviderError(responsePayload) || response.statusText;
      throw new EmailDeliveryError({
        message: `resend_http_${response.status}: ${detail}`,
        messageId: readEmailProviderMessageId(responsePayload),
        payload: {
          request: requestLogPayload,
          response: responsePayload ?? { status: response.status, detail },
        },
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    return {
      provider: EMAIL_PROVIDER,
      messageId: readEmailProviderMessageId(responsePayload),
      payload: {
        request: requestLogPayload,
        response: responsePayload,
      },
    };
  }
}

async function loadRecentPublicAppointment(sb: any, studioId: string, appointmentId: string) {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("studio_id", studioId)
    .eq("status", "confirmed")
    .gte("created_at", since)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

class WhatsAppDeliveryError extends Error {
  messageId: string | null;
  payload: unknown;
  retryable: boolean;

  constructor(input: {
    message: string;
    messageId: string | null;
    payload: unknown;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "WhatsAppDeliveryError";
    this.messageId = input.messageId;
    this.payload = input.payload;
    this.retryable = Boolean(input.retryable);
  }
}

async function getServerEnv(name: string) {
  return process.env[name] ?? "";
}

async function sendWithRetry(send: () => Promise<WhatsAppSendResult>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof WhatsAppDeliveryError ? error.retryable : true;
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

async function sendEmailConfirmationFromContext(
  sb: any,
  ctx: ConfirmationContext,
  renderedMessage: string,
  idempotencyKey: string,
) {
  const existing = await findExistingEmailLog(sb, idempotencyKey);
  if (existing?.status === "sent" || existing?.status === "pending") return existing;

  const recipient = normalizeEmail(ctx.clientEmail);
  const emailEnabled = await isEmailNotificationsEnabled();
  const subject = buildEmailSubject(ctx);
  const content = buildBookingConfirmationEmail(ctx, renderedMessage);

  if (!emailEnabled) {
    console.info("[email] skipped - disabled", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
    });
    return insertEmailLog(sb, ctx, idempotencyKey, {
      status: "skipped",
      reason: "email_notifications_disabled",
      subject,
      message: content.text,
      recipientEmail: recipient,
      provider: EMAIL_PROVIDER,
      payload: { booking_url: ctx.bookingUrl },
    });
  }

  if (!recipient) {
    console.info("[email] skipped - missing_or_invalid_email", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
    });
    return insertEmailLog(sb, ctx, idempotencyKey, {
      status: "skipped",
      reason: "missing_or_invalid_email",
      subject,
      message: content.text,
      recipientEmail: ctx.clientEmail,
      provider: EMAIL_PROVIDER,
      payload: { booking_url: ctx.bookingUrl },
    });
  }

  if (!(await getServerEnv("RESEND_API_KEY"))) {
    console.info("[email] skipped - provider_not_configured", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
    });
    return insertEmailLog(sb, ctx, idempotencyKey, {
      status: "skipped",
      reason: "email_provider_not_configured",
      subject,
      message: content.text,
      recipientEmail: recipient,
      provider: EMAIL_PROVIDER,
      payload: { booking_url: ctx.bookingUrl },
    });
  }

  const pending =
    existing ??
    (await insertEmailLog(sb, ctx, idempotencyKey, {
      status: "pending",
      reason: null,
      subject,
      message: content.text,
      recipientEmail: recipient,
      provider: EMAIL_PROVIDER,
      payload: { booking_url: ctx.bookingUrl },
    }));
  if (!pending) return findExistingEmailLog(sb, idempotencyKey);

  try {
    const sent = await getEmailProvider().send({
      to: recipient,
      subject,
      text: content.text,
      html: content.html,
    });
    console.info("[email] sent", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      message_id: sent.messageId,
      to: maskEmail(recipient),
    });
    return updateEmailLog(sb, pending.id, {
      status: "sent",
      reason: null,
      provider: sent.provider,
      provider_message_id: sent.messageId,
      payload: sent.payload,
    });
  } catch (error) {
    const providerError = error instanceof EmailDeliveryError ? error : null;
    const reason = error instanceof Error ? error.message : "email_send_failed";
    console.error("[email] send failed", {
      idempotency_key: idempotencyKey,
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      reason,
      provider_message_id: providerError?.messageId ?? null,
    });
    return updateEmailLog(sb, pending.id, {
      status: "failed",
      reason,
      provider_message_id: providerError?.messageId ?? null,
      payload: providerError?.payload ?? { error: reason },
    });
  }
}

async function refreshSendDmMessageStatus(
  baseUrl: string,
  apiKey: string,
  messageId: string,
  fallback: unknown,
) {
  let lastPayload = fallback;
  const delays = [1200, 1500, 2000, 2500];

  for (const delay of delays) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(`${baseUrl}/v3/messages/${encodeURIComponent(messageId)}`, {
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
        },
      });
      if (!response.ok) continue;
      lastPayload = await response.json().catch(() => lastPayload);
      const status = String(readSendDmStatus(lastPayload) || "").toUpperCase();
      if (["DELIVERED", "READ", "FAILED", "UNDELIVERED", "CANCELLED", "CANCELED", "FILTERED", "BLOCKED"].includes(status)) {
        return lastPayload;
      }
    } catch {
      continue;
    }
  }

  return lastPayload;
}

export async function reconcilePendingWhatsAppMessages(options?: { studioId?: string }) {
  const sb = admin();
  const apiKey = await getServerEnv("SENDDM_API_KEY");
  const confirmationApiKey = await getServerEnv("SENDDM_CONFIRMATION_API_KEY");
  const araraApiKey = await getServerEnv("ARARA_API_KEY");
  if (!apiKey && !araraApiKey) {
    console.warn("[whatsapp] reconciliation skipped - provider_not_configured");
    return { checked: 0, delivered: 0, pending: 0, failed: 0 };
  }

  const baseUrl = ((await getServerEnv("SENDDM_API_BASE_URL")) || "https://api.sent.dm").replace(
    /\/$/,
    "",
  );
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let query = sb
    .from("whatsapp_message_logs")
    .select(
      "id,studio_id,idempotency_key,status,reason,provider,provider_message_id,payload,created_at,updated_at",
    )
    .in("provider", [WHATSAPP_PROVIDER, ARARA_PROVIDER])
    .or("status.eq.pending,and(status.eq.failed,reason.like.senddm_button_parameter_unresolved*)")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(8);
  if (options?.studioId) query = query.eq("studio_id", options.studioId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const totals = { checked: rows.length, delivered: 0, pending: 0, failed: 0 };

  for (const row of rows) {
    const messageId = String(row.provider_message_id || "").trim();
    if (!messageId) {
      if (row.provider === ARARA_PROVIDER) {
        // The POST may have been accepted even if its response was lost.
        // No message ID means status cannot be queried safely.
        totals.pending += 1;
        continue;
      }
      const createdAt = Date.parse(String(row.created_at || ""));
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > 5 * 60 * 1000) {
        totals.failed += 1;
        await updateLog(sb, row.id, {
          status: "failed",
          reason: `${row.provider === ARARA_PROVIDER ? "arara" : "senddm"}_stale_pending_without_message_id`,
        });
        await finalizeWhatsAppUsage(sb, {
          idempotencyKey: row.idempotency_key,
          outcome: "failed",
          messageLogId: row.id,
          providerStatus: "STALE_WITHOUT_MESSAGE_ID",
        });
      } else {
        totals.pending += 1;
      }
      continue;
    }

    try {
      if (row.provider === ARARA_PROVIDER) {
        if (!araraApiKey) {
          totals.pending += 1;
          continue;
        }
        const status = await getAraraMessageStatus({ apiKey: araraApiKey, messageId });
        const delivered = status === "DELIVERED" || status === "READ";
        const failed = ["FAILED", "CANCELED", "CANCELLED"].includes(status);
        totals[delivered ? "delivered" : failed ? "failed" : "pending"] += 1;
        await updateLog(sb, row.id, {
          status: delivered ? "sent" : failed ? "failed" : "pending",
          reason: failed ? `arara_delivery_${status.toLowerCase()}` : delivered ? null : `arara_awaiting_delivery:${status}`,
          payload: {
            ...(row.payload && typeof row.payload === "object" ? row.payload : {}),
            reconciliation: { checked_at: new Date().toISOString(), delivery_status: status },
          },
        });
        await finalizeWhatsAppUsage(sb, {
          idempotencyKey: row.idempotency_key,
          outcome: delivered ? "delivered" : failed ? "failed" : "submitted",
          messageLogId: row.id,
          providerMessageId: messageId,
          providerStatus: status,
        });
        continue;
      }
      const isConfirmation = row.payload?.request?.metadata?.messageKind === "confirmation" ||
        row.payload?.request?.template?.id === SENDDM_TEMPLATE_MODEL_ID ||
        String(row.idempotency_key || "").startsWith("senddm-whatsapp-confirmation-");
      const lookupKey = isConfirmation ? confirmationApiKey || apiKey : apiKey;
      const response = await fetch(`${baseUrl}/v3/messages/${encodeURIComponent(messageId)}`, {
        headers: {
          "x-api-key": lookupKey,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        totals.pending += 1;
        console.warn("[whatsapp] reconciliation provider lookup failed", {
          message_id: messageId,
          status: response.status,
          detail,
        });
        continue;
      }

      const responsePayload = await response.json().catch(() => null);
      const classification = classifySendDmWhatsAppDelivery(responsePayload);
      const nextStatus =
        classification.state === "delivered"
          ? "sent"
          : classification.state === "failed"
            ? "failed"
            : "pending";
      totals[classification.state === "delivered" ? "delivered" : classification.state] += 1;
      await updateLog(sb, row.id, {
        status: nextStatus,
        reason: classification.reason,
        payload: {
          ...(row.payload && typeof row.payload === "object" ? row.payload : {}),
          response: responsePayload,
          reconciliation: {
            checked_at: new Date().toISOString(),
            delivery_status: classification.status,
            delivery_channel: classification.channel,
          },
        },
      });
      await finalizeWhatsAppUsage(sb, {
        idempotencyKey: row.idempotency_key,
        outcome:
          classification.state === "delivered"
            ? "delivered"
            : classification.state === "failed"
              ? "failed"
              : "submitted",
        messageLogId: row.id,
        providerMessageId: messageId,
        providerStatus: classification.status,
        metadata: classification.reason ? { provider_reason: classification.reason } : {},
      });
    } catch (lookupError) {
      totals.pending += 1;
      console.warn("[whatsapp] reconciliation lookup error", {
        message_id: messageId,
        reason: lookupError instanceof Error ? lookupError.message : String(lookupError),
      });
    }
  }

  console.info("[whatsapp] reconciliation complete", totals);
  return totals;
}

// A request can end after reserving a WhatsApp send but before receiving the
// provider response. Replay uses the original provider idempotency key.
export async function recoverInterruptedAppointmentWhatsAppMessages(options?: {
  studioId?: string;
}) {
  const sb = admin();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let query = sb
    .from("whatsapp_message_logs")
    .select("id,appointment_id,idempotency_key,payload,created_at")
    .eq("provider", WHATSAPP_PROVIDER)
    .eq("status", "failed")
    .in("reason", ["senddm_stale_pending_without_message_id", "senddm_http_404: Template not found"])
    .is("provider_message_id", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);
  if (options?.studioId) query = query.eq("studio_id", options.studioId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let retried = 0;
  for (const row of data ?? []) {
    const appointmentId = String(row.appointment_id || "");
    const key = String(row.idempotency_key || "");
    const kind = key.startsWith(`senddm-whatsapp-cancellation-appointment-${appointmentId}-`)
      ? "cancellation"
      : key.startsWith(`senddm-whatsapp-reschedule-appointment-${appointmentId}-`)
        ? "reschedule"
        : key === `senddm-whatsapp-confirmation-appointment-${appointmentId}`
          ? "confirmation"
          : key.startsWith(`arara-reminder-2h-${appointmentId}-`)
            ? "reminder_2h"
            : null;
    if (!appointmentId || !kind || Number(row.payload?.recovery_attempts || 0) >= 2) continue;
    const { data: appointment, error: appointmentError } = await sb
      .from("appointments")
      .select("status,starts_at")
      .eq("id", appointmentId)
      .maybeSingle();
    if (appointmentError) throw new Error(appointmentError.message);
    if (!appointment || (kind === "cancellation" ? appointment.status !== "cancelled" :
      appointment.status !== "confirmed")) continue;
    const startsAt = Date.parse(appointment.starts_at);
    if (!Number.isFinite(startsAt)) continue;
    if (startsAt <= Date.now()) continue;
    if (kind === "cancellation" || kind === "reschedule") {
      if (key !== `senddm-whatsapp-${kind}-appointment-${appointmentId}-${startsAt}`) continue;
    } else if (kind === "reminder_2h") {
      if (key !== `arara-reminder-2h-${appointmentId}-${startsAt}` ||
        startsAt <= Date.now() || startsAt > Date.now() + 120 * 60 * 1000) continue;
    }
    const ctx = await loadAppointmentConfirmationContext(sb, appointmentId);
    if (!ctx) continue;
    const template = kind === "cancellation"
      ? "Ola, {nomeCliente}. A sua marcacao de {servico} com {profissional} para {data} as {hora} foi cancelada."
      : kind === "reschedule"
        ? "Ola, {nomeCliente}. A sua marcacao de {servico} com {profissional} foi remarcada para {data} as {hora}."
        : kind === "reminder_2h"
          ? "Olá, {nomeCliente}. A sua marcação em {nome_estudio} para {servico} é hoje, {data}, às {hora}. Esperamos por si dentro de duas horas."
          : ctx.template;
    await sendConfirmationFromContext(sb, { ...ctx, template, messageKind: kind === "confirmation" ? undefined : kind }, key, {
      skipEmail: true,
      recoveryAttempt: true,
    });
    retried += 1;
  }
  console.info("[whatsapp] interrupted lifecycle recovery complete", { checked: data?.length ?? 0, retried });
  return { checked: data?.length ?? 0, retried };
}

export async function dispatchMissingAppointmentWhatsAppConfirmations(options?: {
  studioId?: string;
}) {
  const sb = admin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let query = sb
    .from("appointments")
    .select("id,studio_id")
    .eq("status", "confirmed")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(20);
  if (options?.studioId) query = query.eq("studio_id", options.studioId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const appointments = (data ?? []) as Array<{ id: string; studio_id: string }>;
  if (appointments.length === 0) return { checked: 0, dispatched: 0 };

  const appointmentIds = appointments.map((appointment) => appointment.id);
  const { data: existingLogs, error: logsError } = await sb
    .from("whatsapp_message_logs")
    .select("appointment_id,status,provider,provider_message_id,reason")
    .in("appointment_id", appointmentIds);
  if (logsError) throw new Error(logsError.message);
  const loggedAppointmentIds = new Set(
    ((existingLogs ?? []) as Array<{
      appointment_id: string | null;
      status: string;
      provider: string;
      provider_message_id: string | null;
      reason: string | null;
    }>)
      .filter((row) => !(row.status === "failed" &&
        row.provider === ARARA_PROVIDER &&
        row.provider_message_id &&
        row.reason === "arara_delivery_failed"))
      .map((row) => row.appointment_id)
      .filter(Boolean),
  );
  const missing = appointments.filter((appointment) => !loggedAppointmentIds.has(appointment.id));

  let dispatched = 0;
  for (const appointment of missing) {
    const ctx = await loadAppointmentConfirmationContext(sb, appointment.id);
    if (!ctx?.autoEnabled) continue;
    await sendConfirmationFromContext(
      sb,
      ctx,
      appointmentConfirmationIdempotencyKey(
        appointment.id,
        `senddm-whatsapp-public-appointment-${appointment.id}`,
      ),
    );
    dispatched += 1;
  }

  const result = { checked: appointments.length, dispatched };
  console.info("[whatsapp] missing confirmation dispatch complete", result);
  return result;
}

async function loadSendDmContactDiagnostics(baseUrl: string, apiKey: string, payload: any) {
  const contactId = payload?.data?.contact_id;
  if (!contactId) return null;
  try {
    const response = await fetch(
      `${baseUrl}/v3/contacts/${encodeURIComponent(String(contactId))}`,
      {
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) return { contact_id: String(contactId), lookup_status: response.status };
    const contact = await response.json().catch(() => null);
    return sanitizeSendDmContactPayload(contact);
  } catch {
    return { contact_id: String(contactId), lookup_status: "failed" };
  }
}

function readSendDmWhatsAppChannelError(contactDiagnostics: any) {
  const channels = String(contactDiagnostics?.available_channels || "")
    .split(",")
    .map((channel) => channel.trim().toLowerCase())
    .filter(Boolean);
  if (channels.length > 0 && !channels.includes("whatsapp")) {
    return "senddm_whatsapp_channel_unavailable: contact_available_channels_excludes_whatsapp";
  }
  return "";
}

function readEmailProviderMessageId(payload: any) {
  return payload?.id ?? payload?.data?.id ?? payload?.message_id ?? payload?.messageId ?? null;
}

function readEmailProviderError(payload: any) {
  return (
    payload?.message ?? payload?.error?.message ?? payload?.error ?? payload?.error_message ?? ""
  );
}

async function isEmailNotificationsEnabled() {
  const value = ((await getServerEnv("EMAIL_NOTIFICATIONS_ENABLED")) || "true").toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function buildEmailSubject(ctx: ConfirmationContext) {
  const sender = ctx.studioName || "O seu estúdio";
  if (ctx.messageKind === "reschedule") {
    return `${sender}: reserva remarcada para ${formatEmailDateTime(ctx.startsAt, ctx.studioTimezone)}`;
  }
  if (ctx.messageKind === "cancellation") {
    return `${sender}: reserva cancelada`;
  }
  return `${sender}: reserva confirmada para ${formatEmailDateTime(ctx.startsAt, ctx.studioTimezone)}`;
}

function buildBookingConfirmationEmail(ctx: ConfirmationContext, renderedMessage: string) {
  const variables = buildTemplateVariables(ctx);
  const rawStudioName = ctx.studioName || "O seu estúdio";
  const studioName = escapeHtml(rawStudioName);
  const clientName = escapeHtml(ctx.clientName || "Cliente");
  const serviceName = escapeHtml(ctx.serviceName || "Serviço");
  const staffName = escapeHtml(ctx.staffName || "Profissional");
  const date = escapeHtml(variables.data);
  const time = escapeHtml(variables.hora);
  const reservationCode = escapeHtml(
    getPublicReservationCode(publicOrderIdFromUrl(ctx.bookingUrl) || ctx.appointmentId),
  );
  const actionBaseUrl = ctx.bookingUrl || getPublicOrigin();
  const bookingUrl = escapeHtml(actionBaseUrl);
  const rescheduleUrl = escapeHtml(`${actionBaseUrl}?acao=remarcar`);
  const cancelUrl = escapeHtml(`${actionBaseUrl}?acao=cancelar`);
  const contactUrl = escapeHtml(`${actionBaseUrl}?acao=contactar`);
  const heading =
    ctx.messageKind === "reschedule"
      ? "Reserva remarcada"
      : ctx.messageKind === "cancellation"
        ? "Reserva cancelada"
        : "Reserva confirmada";
  const preheader = escapeHtml(`${heading} para ${variables.data} às ${variables.hora}.`);
  const text = [
    `Olá, ${ctx.clientName || "Cliente"}.`,
    "",
    `A sua reserva no ${rawStudioName} foi confirmada.`,
    `Código da reserva: ${getPublicReservationCode(publicOrderIdFromUrl(ctx.bookingUrl) || ctx.appointmentId)}`,
    `Data: ${variables.data}`,
    `Hora: ${variables.hora}`,
    `Serviço: ${ctx.serviceName}`,
    `Profissional: ${ctx.staffName}`,
    "",
    ctx.bookingUrl ? `Ver reserva: ${ctx.bookingUrl}` : "",
    "",
    `Obrigado, ${rawStudioName}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html>
<html lang="pt">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(buildEmailSubject(ctx))}</title>
  </head>
  <body style="margin:0;background:#f6f3ef;color:#171412;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f3ef;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #e8dfd6;border-radius:20px;overflow:hidden;box-shadow:0 18px 60px rgba(56,39,24,.10);">
            <tr>
              <td style="padding:28px 28px 18px;background:#171412;color:#fff;">
                <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#d9b98f;font-weight:700;">${studioName}</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;font-weight:800;">${escapeHtml(heading)}</h1>
                <p style="margin:10px 0 0;color:#e8dfd6;font-size:15px;line-height:1.55;">${studioName} confirmou a sua marcação.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Olá, <strong>${clientName}</strong>.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
                  ${emailDetailRow("Reserva", reservationCode)}
                  ${emailDetailRow("Data", date)}
                  ${emailDetailRow("Hora", time)}
                  ${emailDetailRow("Serviço", serviceName)}
                  ${emailDetailRow("Profissional", staffName)}
                </table>
                <div style="margin:24px 0 0;padding:16px 18px;border-radius:16px;background:#fbf8f4;border:1px solid #eee4d9;">
                  <p style="margin:0;color:#5f544a;font-size:14px;line-height:1.55;">${escapeHtml(renderedMessage).replace(/\n/g, "<br>")}</p>
                </div>
                <div style="margin:28px 0 0;text-align:center;">
                  <a href="${bookingUrl}" style="display:inline-block;background:#171412;color:#fff;text-decoration:none;border-radius:999px;padding:14px 24px;font-size:15px;font-weight:800;">Ver reserva</a>
                </div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-collapse:separate;border-spacing:8px;">
                  <tr>
                    <td align="center" style="width:33%;"><a href="${rescheduleUrl}" style="display:block;border:1px solid #e8dfd6;color:#171412;text-decoration:none;border-radius:999px;padding:12px 10px;font-size:13px;font-weight:800;">Remarcar</a></td>
                    <td align="center" style="width:33%;"><a href="${cancelUrl}" style="display:block;border:1px solid #e8dfd6;color:#171412;text-decoration:none;border-radius:999px;padding:12px 10px;font-size:13px;font-weight:800;">Cancelar</a></td>
                    <td align="center" style="width:33%;"><a href="${contactUrl}" style="display:block;border:1px solid #e8dfd6;color:#171412;text-decoration:none;border-radius:999px;padding:12px 10px;font-size:13px;font-weight:800;">Falar</a></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 26px;color:#7a6d60;font-size:12px;line-height:1.5;background:#fbf8f4;">
                Mensagem automática enviada pelo estúdio sobre a sua reserva.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { text, html };
}

function emailDetailRow(label: string, value: string) {
  return `<tr>
    <td style="width:38%;padding:12px 14px;background:#fbf8f4;border:1px solid #eee4d9;border-right:0;border-radius:14px 0 0 14px;color:#7a6d60;font-size:13px;font-weight:700;">${escapeHtml(label)}</td>
    <td style="padding:12px 14px;background:#fbf8f4;border:1px solid #eee4d9;border-left:0;border-radius:0 14px 14px 0;color:#171412;font-size:14px;font-weight:800;">${value}</td>
  </tr>`;
}

function formatEmailDateTime(value: string, timeZone?: string | null) {
  return formatStudioDateTime(value, timeZone);
}

function sanitizeSendDmRequestPayload(payload: any) {
  const copy = JSON.parse(JSON.stringify(payload));
  if (Array.isArray(copy?.to)) {
    copy.to = copy.to.map((phone: string) => maskPhone(String(phone)));
  }
  if (copy?.template?.parameters && typeof copy.template.parameters === "object") {
    copy.template.parameters = Object.fromEntries(
      Object.entries(copy.template.parameters).map(([name, value], index) => [
        name,
        {
          index: SENDDM_BOOKING_CONFIRMATION_PARAMETERS.indexOf(name as any) + 1 || index + 1,
          name,
          hasValue: typeof value === "string" && value.trim().length > 0,
          length: typeof value === "string" ? value.trim().length : 0,
          sample: maskTemplateParameterValue(value),
        },
      ]),
    );
  }
  if (copy?.metadata?.reservationUrl) {
    copy.metadata.reservationUrl = maskUrlToken(String(copy.metadata.reservationUrl));
  }
  if (copy?.metadata?.orderId) {
    copy.metadata.orderId = maskToken(String(copy.metadata.orderId));
  }
  return copy;
}

function sanitizeSendDmContactPayload(payload: any) {
  const contact = payload?.data ?? payload;
  if (!contact) return null;
  return {
    contact_id: contact.id ?? null,
    phone: contact.format_e164 ? maskPhone(String(contact.format_e164)) : null,
    region_code: contact.region_code ?? null,
    available_channels: contact.available_channels ?? null,
    default_channel: contact.default_channel ?? null,
    opt_out: Boolean(contact.opt_out),
    updated_at: contact.updated_at ?? null,
  };
}

function sanitizeEmailRequestPayload(payload: any) {
  const copy = JSON.parse(JSON.stringify(payload));
  if (Array.isArray(copy?.to)) {
    copy.to = copy.to.map((email: string) => maskEmail(String(email)));
  }
  if (copy?.from) copy.from = maskEmail(String(copy.from));
  if (copy?.reply_to) copy.reply_to = maskEmail(String(copy.reply_to));
  return copy;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `***${digits.slice(-4)}`;
}

function maskTemplateParameterValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return maskUrlToken(text);
  if (/^[a-f0-9-]{16,}$/i.test(text)) return maskToken(text);
  if (text.length <= 4) return "***";
  return `${text.slice(0, 2)}***${text.slice(-1)}`;
}

function maskUrlToken(value: string) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length > 0) {
      parts[parts.length - 1] = maskToken(parts[parts.length - 1]);
      url.pathname = `/${parts.join("/")}`;
    }
    return url.toString();
  } catch {
    return maskToken(value);
  }
}

function maskToken(value: string) {
  const text = String(value || "");
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function maskEmail(value: string) {
  const match = value.match(/<?([^<>\s@]+)@([^<>\s]+)>?$/);
  if (!match) return "***";
  const name = match[1] ?? "";
  const domain = match[2] ?? "";
  return `${name.slice(0, 2)}***@${domain}`;
}

function normalizeEmail(value?: string | null) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadConfirmationContext(
  sb: any,
  input: { stripePaymentIntentId?: string; paymentIntentId?: string },
): Promise<ConfirmationContext | null> {
  let query = sb
    .from("payment_intents")
    .select(
      "id,studio_id,appointment_id,booking_request_id,stripe_payment_intent_id,amount_cents,currency,status",
    )
    .eq("status", "succeeded")
    .limit(1);
  query = input.paymentIntentId
    ? query.eq("id", input.paymentIntentId)
    : query.eq("stripe_payment_intent_id", input.stripePaymentIntentId);
  const { data: payment, error } = await query.maybeSingle();
  if (error || !payment) return null;

  let appointmentId = (payment.appointment_id as string | null) ?? null;
  let bookingRequest: any = null;
  if (!appointmentId && payment.booking_request_id) {
    const { data } = await sb
      .from("booking_payment_requests")
      .select(
        "id,appointment_id,client_name,client_phone,client_email,starts_at,service_ids,staff_id",
      )
      .eq("id", payment.booking_request_id)
      .maybeSingle();
    bookingRequest = data;
    appointmentId = (data?.appointment_id as string | null) ?? null;
  }

  const studio = await loadStudioWhatsApp(sb, payment.studio_id as string);
  let clientName = bookingRequest?.client_name ?? "Cliente";
  let clientPhone = bookingRequest?.client_phone ?? "";
  let clientEmail = bookingRequest?.client_email ?? null;
  let serviceName = "Serviço";
  let staffName = "Profissional";
  let startsAt = bookingRequest?.starts_at ?? new Date().toISOString();

  if (appointmentId) {
    const { data: appt } = await sb
      .from("appointments")
      .select("id,starts_at,clients(name,phone,email),staff(name)")
      .eq("id", appointmentId)
      .maybeSingle();
    clientName = appt?.clients?.name ?? clientName;
    clientPhone = appt?.clients?.phone ?? clientPhone;
    clientEmail = appt?.clients?.email ?? clientEmail;
    staffName = appt?.staff?.name ?? staffName;
    startsAt = appt?.starts_at ?? startsAt;
    const { data: lines } = await sb
      .from("appointment_services")
      .select(
        "position,services(name),staff:staff!appointment_services_staff_id_fkey(id,name)",
      )
      .eq("appointment_id", appointmentId);
    serviceName = joinServiceNames(lines) || serviceName;
    staffName = getAppointmentProfessionalDisplayName(lines, appt?.staff?.name);
  } else if (bookingRequest?.service_ids?.length) {
    const { data: services } = await sb
      .from("services")
      .select("name")
      .in("id", bookingRequest.service_ids);
    serviceName = (services ?? [])
      .map((service: any) => service.name)
      .filter(Boolean)
      .join(", ");
    const { data: staff } = await sb
      .from("staff")
      .select("name")
      .eq("id", bookingRequest.staff_id)
      .maybeSingle();
    staffName = staff?.name ?? staffName;
  }

  return {
    studioId: payment.studio_id as string,
    studioName: studio.name ?? "Estúdio",
    appointmentId,
    paymentRowId: payment.id,
    paymentIntentId: payment.stripe_payment_intent_id ?? payment.id,
    clientName,
    clientPhone,
    clientEmail,
    serviceName: serviceName || "Serviço",
    staffName,
    startsAt,
    studioTimezone: studio.timezone ?? "Europe/Lisbon",
    paidAmount: Number(payment.amount_cents || 0) / 100,
    currency: payment.currency ?? "eur",
    template: studio.whatsapp_default_message ?? DEFAULT_TEMPLATE,
    autoEnabled: Boolean(studio.whatsapp_auto_send_enabled),
    bookingUrl: appointmentId ? await ensureAppointmentPublicUrl(sb, appointmentId) : "",
  };
}

async function loadAppointmentConfirmationContext(
  sb: any,
  appointmentId: string,
): Promise<ConfirmationContext | null> {
  const { data: appt, error } = await sb
    .from("appointments")
    .select(
      "id,studio_id,client_id,staff_id,starts_at,total_price",
    )
    .eq("id", appointmentId)
    .maybeSingle();
  if (error || !appt?.id) return null;

  const [{ data: client }, { data: staff }, { data: studio }, { data: lines }] =
    await Promise.all([
      sb
        .from("clients")
        .select("name,phone,email")
        .eq("id", appt.client_id)
        .eq("studio_id", appt.studio_id)
        .maybeSingle(),
      sb
        .from("staff")
        .select("name")
        .eq("id", appt.staff_id)
        .eq("studio_id", appt.studio_id)
        .maybeSingle(),
      sb
        .from("studios")
        .select("id,name,timezone,whatsapp_auto_send_enabled,whatsapp_default_message")
        .eq("id", appt.studio_id)
        .maybeSingle(),
      sb
        .from("appointment_services")
        .select(
          "position,services(name),staff:staff!appointment_services_staff_id_fkey(id,name)",
        )
        .eq("appointment_id", appointmentId),
    ]);

  const realClientName = String(client?.name ?? "").trim();
  if (!realClientName) {
    console.error("[whatsapp] appointment_client_name_missing", {
      appointment_id: appointmentId,
      studio_id: appt.studio_id,
      client_id: appt.client_id ?? null,
    });
    return null;
  }

  return {
    studioId: appt.studio_id,
    studioName: studio?.name ?? "Estudio",
    appointmentId,
    paymentRowId: `appointment-${appointmentId}`,
    paymentIntentId: `appointment-${appointmentId}`,
    clientName: realClientName,
    clientPhone: client?.phone ?? "",
    clientEmail: client?.email ?? null,
    serviceName: joinServiceNames(lines) || "Serviço",
    staffName: getAppointmentProfessionalDisplayName(lines, staff?.name),
    startsAt: appt.starts_at,
    studioTimezone: studio?.timezone ?? "Europe/Lisbon",
    paidAmount: 0,
    currency: "eur",
    template: studio?.whatsapp_default_message ?? DEFAULT_TEMPLATE,
    autoEnabled: Boolean(studio?.whatsapp_auto_send_enabled),
    bookingUrl: await ensureAppointmentPublicUrl(sb, appointmentId),
  };
}

async function loadStudioWhatsApp(sb: any, studioId: string) {
  const full = await sb
    .from("studios")
    .select("id,name,timezone,whatsapp_auto_send_enabled,whatsapp_default_message")
    .eq("id", studioId)
    .maybeSingle();
  if (!full.error && full.data) return withWhatsAppDefaults(full.data);

  const missingWhatsAppColumns =
    isMissingWhatsAppSchema(full.error) ||
    String(full.error?.message ?? "")
      .toLowerCase()
      .includes("whatsapp_");

  if (full.error && !missingWhatsAppColumns) {
    throw new Error(full.error.message);
  }

  const base = await sb.from("studios").select("id,name,timezone").eq("id", studioId).maybeSingle();
  if (base.error) throw new Error(base.error.message);
  if (!base.data) throw new Error("studio_not_found");
  return withWhatsAppDefaults(base.data);
}

function withWhatsAppDefaults(studio: any) {
  return {
    ...studio,
    whatsapp_auto_send_enabled: Boolean(studio.whatsapp_auto_send_enabled),
    whatsapp_default_message: studio.whatsapp_default_message ?? DEFAULT_TEMPLATE,
  };
}

function normalizeWhatsAppStudio(studio: any) {
  return {
    studioId: studio.id as string,
    autoSendEnabled: Boolean(studio.whatsapp_auto_send_enabled),
    messageTemplate: (studio.whatsapp_default_message as string) ?? DEFAULT_TEMPLATE,
    provider: WHATSAPP_PROVIDER,
    fromNumber: "",
    lastError: null,
  };
}

function renderMessage(template: string, ctx: ConfirmationContext) {
  const variables = buildTemplateVariables(ctx);
  const legacyVariables: Record<string, string> = {
    nome_cliente: variables.nomeCliente,
    serviço: variables.servico,
    valor_sinal: formatMoney(ctx.paidAmount, ctx.currency),
    nome_estudio: ctx.studioName,
    nome_estúdio: ctx.studioName,
    link_agendamento: ctx.bookingUrl,
    reservationToken: ctx.bookingUrl,
  };
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const normalizedKey = key.trim();
    return (
      variables[normalizedKey as keyof WhatsAppTemplateVariables] ??
      legacyVariables[normalizedKey] ??
      ""
    );
  });
}

function buildTemplateVariables(ctx: ConfirmationContext): WhatsAppTemplateVariables {
  return {
    nomeCliente: toSendDmTemplateText(ctx.clientName, "Cliente"),
    data: formatStudioDate(ctx.startsAt, ctx.studioTimezone),
    hora: formatStudioTime(ctx.startsAt, ctx.studioTimezone),
    servico: toSendDmTemplateText(ctx.serviceName, "Servico"),
    profissional: toSendDmTemplateText(
      ctx.staffName || ctx.studioName,
      ctx.studioName || "Estudio",
    ),
    orderId: toSendDmTemplateText(publicOrderIdFromUrl(ctx.bookingUrl), "reserva"),
  };
}

function buildSendDmTemplateParameterObject(variables: WhatsAppTemplateVariables) {
  return Object.fromEntries(
    SENDDM_BOOKING_CONFIRMATION_PARAMETERS.map((name) => [name, variables[name]]),
  ) as SendDmTemplateParameters;
}

function toSendDmTemplateText(value: string | null | undefined, fallback: string) {
  const normalized = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, 200);
}

function maskPhoneForLog(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length <= 4) return digits ? "***" : null;
  return `***${digits.slice(-4)}`;
}

function isMissingWhatsAppSchema(error: any) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    message.includes("whatsapp_auto_send_enabled") ||
    message.includes("whatsapp_default_message") ||
    message.includes("schema cache")
  );
}

function joinServiceNames(lines: any[] | null | undefined) {
  return (lines ?? [])
    .map((line) => line?.services?.name)
    .filter(Boolean)
    .join(", ");
}

function normalizeWhatsAppPhone(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^whatsapp:/i, "").trim();
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 9) return null;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (cleaned.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("351")) return `+${digits}`;
  if (digits.length === 9) return `+351${digits}`;
  return `+${digits}`;
}

function formatMoney(value: number, currency = "eur") {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value || 0);
}

async function ensureAppointmentPublicUrl(sb: any, appointmentId: string) {
  const token = await ensureAppointmentPublicToken(sb, appointmentId);
  return `${getPublicOrigin()}/r/${token}`;
}

async function loadLatestAppointmentForStudio(sb: any, studioId: string, phone: string) {
  const { data, error } = await sb
    .from("appointments")
    .select("id,clients(phone)")
    .eq("studio_id", studioId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  const normalizedTarget = normalizeWhatsAppPhone(phone);
  const appointment = ((data ?? []) as any[]).find((row) => {
    const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    return normalizeWhatsAppPhone(client?.phone) === normalizedTarget;
  });
  if (!appointment?.id) {
    throw new Error(
      "Para testar o botão, use o WhatsApp de uma cliente que já tenha uma marcação neste estúdio.",
    );
  }
  return { id: appointment.id as string, url: await ensureAppointmentPublicUrl(sb, appointment.id) };
}

function getPublicOrigin() {
  return "https://bellza.pt";
}

function publicOrderIdFromUrl(value: string) {
  const trimmed = value.replace(/\/$/, "");
  const orderId = trimmed.split("/").pop();
  return orderId || "";
}

async function ensureAppointmentPublicToken(sb: any, appointmentId: string) {
  const { data, error } = await sb
    .from("appointments")
    .select("public_token")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.public_token) return data.public_token as string;

  const token =
    crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const { error: updateError } = await sb
    .from("appointments")
    .update({ public_token: token, updated_at: new Date().toISOString() })
    .eq("id", appointmentId);
  if (updateError) throw new Error(updateError.message);
  return token;
}

async function findExistingLog(sb: any, idempotencyKey: string) {
  const { data } = await sb
    .from("whatsapp_message_logs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return data;
}

async function findExistingConfirmationLog(sb: any, ctx: ConfirmationContext) {
  if (
    ctx.paymentRowId &&
    ctx.paymentRowId !== "test" &&
    !ctx.paymentRowId.startsWith("appointment-")
  ) {
    const { data } = await sb
      .from("whatsapp_message_logs")
      .select("*")
      .eq("payment_intent_id", ctx.paymentRowId)
      .in("status", ["sent", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }

  if (ctx.appointmentId) {
    const { data } = await sb
      .from("whatsapp_message_logs")
      .select("*")
      .eq("appointment_id", ctx.appointmentId)
      .in("status", ["sent", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}

function isStalePendingWhatsAppLog(log: any) {
  if (log?.status !== "pending") return false;
  if (log?.provider_message_id) return false;
  const payload = log?.payload;
  if (payload?.response || payload?.request) return false;
  const createdAt = Date.parse(String(log?.created_at ?? ""));
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt > 2 * 60 * 1000;
}

async function findExistingEmailLog(sb: any, idempotencyKey: string) {
  const { data, error } = await sb
    .from("email_message_logs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (isMissingEmailLogSchema(error)) return null;
  if (error) throw new Error(error.message);
  return data;
}

async function insertLog(
  sb: any,
  ctx: ConfirmationContext,
  idempotencyKey: string,
  input: {
    status: "pending" | "sent" | "failed" | "skipped";
    reason: string | null;
    message: string;
    recipientPhone: string | null;
    provider: string;
  },
) {
  const { data, error } = await sb
    .from("whatsapp_message_logs")
    .insert({
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      payment_intent_id:
        ctx.paymentRowId === "test" || ctx.paymentRowId.startsWith("appointment-")
          ? null
          : ctx.paymentRowId,
      idempotency_key: idempotencyKey,
      provider: input.provider,
      recipient_phone: input.recipientPhone,
      status: input.status,
      reason: input.reason,
      message: input.message,
      payload: {
        payment_intent_id: ctx.paymentIntentId,
        service: ctx.serviceName,
        staff: ctx.staffName,
        booking_url: ctx.bookingUrl,
      },
    })
    .select("*")
    .maybeSingle();
  if (error?.code === "23505") return null;
  if (error) throw new Error(error.message);
  return data;
}

async function insertEmailLog(
  sb: any,
  ctx: ConfirmationContext,
  idempotencyKey: string,
  input: {
    status: "pending" | "sent" | "failed" | "skipped";
    reason: string | null;
    subject: string;
    message: string;
    recipientEmail: string | null;
    provider: string;
    payload?: Record<string, unknown>;
  },
) {
  const { data, error } = await sb
    .from("email_message_logs")
    .insert({
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      payment_intent_id:
        ctx.paymentRowId === "test" || ctx.paymentRowId.startsWith("appointment-")
          ? null
          : ctx.paymentRowId,
      idempotency_key: idempotencyKey,
      provider: input.provider,
      recipient_email: input.recipientEmail,
      status: input.status,
      reason: input.reason,
      subject: input.subject,
      message: input.message,
      payload: {
        payment_intent_id: ctx.paymentIntentId,
        service: ctx.serviceName,
        staff: ctx.staffName,
        booking_url: ctx.bookingUrl,
        ...(input.payload ?? {}),
      },
    })
    .select("*")
    .maybeSingle();
  if (error?.code === "23505") return null;
  if (isMissingEmailLogSchema(error)) {
    console.warn("[email] log schema missing", { idempotency_key: idempotencyKey });
    return null;
  }
  if (error) throw new Error(error.message);
  return data;
}

async function updateLog(sb: any, id: string, patch: Record<string, unknown>) {
  const { data, error } = await sb
    .from("whatsapp_message_logs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function updateEmailLog(sb: any, id: string, patch: Record<string, unknown>) {
  const { data, error } = await sb
    .from("email_message_logs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (isMissingEmailLogSchema(error)) {
    console.warn("[email] log schema missing", { id });
    return null;
  }
  if (error) throw new Error(error.message);
  return data;
}

function isMissingEmailLogSchema(error: any) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    message.includes("email_message_logs") ||
    message.includes("schema cache")
  );
}
