import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertAppointmentAccess,
  assertStudioAccessWithOptions,
  rateLimitOrThrow,
} from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { formatStudioDate, formatStudioDateTime, formatStudioTime } from "@/lib/studio-time";

const DEFAULT_TEMPLATE =
  "Ola, {nomeCliente}. Confirmamos a sua marcacao de {servico} com {profissional} para {data} as {hora}.";

const WHATSAPP_PROVIDER = "senddm_whatsapp";
const SENDDM_TEMPLATE_INTERNAL_NAME = "Marca\u00e7\u00e3o";
const SENDDM_TEMPLATE_MODEL_ID = "aca219e7-63cb-4eea-a8fd-9aee187e8676";
const SENDDM_TEMPLATE_APPROVED_NAME = "new_template__hkmlmqkyap";
const SENDDM_WHATSAPP_TEMPLATE_ID = "1772571720773309";
const SENDDM_BOOKING_CONFIRMATION_PARAMETERS = [
  "nomeCliente",
  "data",
  "hora",
  "servico",
  "profissional",
  "orderId",
] as const;
const EMAIL_PROVIDER = "resend_email";
const EMAIL_SUBJECT_PREFIX = "Bellza";

type WhatsAppSendInput = {
  to: string;
  body: string;
  reservationUrl: string;
  orderId: string;
  appointmentId?: string | null;
  templateVariables: WhatsAppTemplateVariables;
  messageKind?: ConfirmationContext["messageKind"];
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
  messageKind?: "confirmation" | "reschedule" | "cancellation";
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
      requirePremium: true,
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
      requirePremium: true,
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
    await assertStudioAccessWithOptions(sb, userId, data.studioId, { requirePremium: true });
    await rateLimitOrThrow({
      key: `whatsapp-test:${userId}:${data.studioId}`,
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });
    const studio = await loadStudioWhatsApp(sb, data.studioId);
    const to = normalizeWhatsAppPhone(data.phone);
    if (!to) throw new Error("Telefone invalido para WhatsApp.");

    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const bookingUrl = await loadLatestAppointmentPublicUrlForStudio(sb, data.studioId);
    const ctx: ConfirmationContext = {
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
      bookingUrl,
    };
    const templateVariables = buildTemplateVariables(ctx);
    const result = await getWhatsAppProvider().sendText({
      to,
      body: renderMessage(ctx.template, ctx),
      reservationUrl: ctx.bookingUrl,
      orderId: publicOrderIdFromUrl(ctx.bookingUrl),
      templateVariables,
    });
    return { ok: true, messageId: result.messageId ?? null };
  });

export async function sendAppointmentConfirmationMessage(
  sb: any,
  input: { stripePaymentIntentId?: string; paymentIntentId?: string },
) {
  const ctx = await loadConfirmationContext(sb, input);
  if (!ctx) return null;

  const idempotencyKey = `senddm-whatsapp-payment-${ctx.paymentRowId}`;
  return sendConfirmationFromContext(sb, ctx, idempotencyKey);
}

export const sendAppointmentConfirmationForAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appointmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertAppointmentAccess(sb, (context as any).userId, data.appointmentId, {
      requirePremium: true,
    });
    const ctx = await loadAppointmentConfirmationContext(sb, data.appointmentId);
    if (!ctx) return null;
    return sendConfirmationFromContext(sb, ctx, `senddm-whatsapp-appointment-${data.appointmentId}`);
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
      `senddm-whatsapp-public-appointment-${data.appointmentId}`,
    );
    return { ok: Boolean(result), status: result?.status ?? null, messageId: result?.provider_message_id ?? null };
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

async function sendConfirmationFromContext(sb: any, ctx: ConfirmationContext, idempotencyKey: string) {
  const existing = (await findExistingLog(sb, idempotencyKey)) ?? (await findExistingConfirmationLog(sb, ctx));
  const rendered = renderMessage(ctx.template || DEFAULT_TEMPLATE, ctx);
  const emailPromise = sendEmailConfirmationFromContext(
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
  });
  if (existing?.status === "sent" || (existing?.status === "pending" && !isStalePendingWhatsAppLog(existing))) {
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

  if (!ctx.autoEnabled) {
    console.warn("[whatsapp] skipped — auto_send_disabled", { studio_id: ctx.studioId, appointment_id: ctx.appointmentId });
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
        payment_intent_id: ctx.paymentIntentId,
        service: ctx.serviceName,
        staff: ctx.staffName,
        booking_url: ctx.bookingUrl,
      },
    });
  }

  try {
    const sent = await getWhatsAppProvider().sendText({
      to: recipient,
      body: rendered,
      reservationUrl: ctx.bookingUrl,
      orderId: publicOrderIdFromUrl(ctx.bookingUrl),
      appointmentId: ctx.appointmentId,
      templateVariables: buildTemplateVariables(ctx),
      messageKind: ctx.messageKind ?? "confirmation",
    });
    console.info("[whatsapp] sent", {
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      message_id: sent.messageId,
      delivery_status: sent.deliveryStatus,
      to: recipient,
    });
    const log = await updateLog(sb, pending.id, {
      status: "sent",
      reason: null,
      provider: sent.provider,
      provider_message_id: sent.messageId,
      payload: sent.payload,
    });
    await emailPromise;
    return log;
  } catch (error) {
    const providerError = error instanceof WhatsAppDeliveryError ? error : null;
    const reason = error instanceof Error ? error.message : "whatsapp_send_failed";
    console.error("[whatsapp] send failed", {
      idempotency_key: idempotencyKey,
      studio_id: ctx.studioId,
      appointment_id: ctx.appointmentId,
      reason,
      provider_message_id: providerError?.messageId ?? null,
    });
    const log = await updateLog(sb, pending.id, {
      status: "failed",
      reason,
      provider_message_id: providerError?.messageId ?? null,
      payload: providerError?.payload ?? { error: reason },
    });
    await emailPromise;
    return log;
  }
}

function getWhatsAppProvider(): WhatsAppProvider {
  return new SendDmService();
}

function getEmailProvider(): EmailProvider {
  return new ResendEmailService();
}

class SendDmService implements WhatsAppProvider {
  name = WHATSAPP_PROVIDER;

  async sendText(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    const apiKey = await getServerEnv("SENDDM_API_KEY");
    const modelId = (await getServerEnv("SENDDM_MODEL_ID")) || SENDDM_TEMPLATE_MODEL_ID;
    const whatsappTemplateId = (await getServerEnv("SENDDM_WHATSAPP_TEMPLATE_ID")) || SENDDM_WHATSAPP_TEMPLATE_ID;
    const baseUrl = ((await getServerEnv("SENDDM_API_BASE_URL")) || "https://api.sent.dm").replace(/\/$/, "");
    const language = (await getServerEnv("SENDDM_WHATSAPP_TEMPLATE_LANGUAGE")) || "pt_BR";
    const senderId = await getServerEnv("SENDDM_WHATSAPP_SENDER_ID");
    const templateName =
      (await getServerEnv("SENDDM_WHATSAPP_TEMPLATE_NAME")) || SENDDM_TEMPLATE_APPROVED_NAME;
    const internalTemplate =
      (await getServerEnv("SENDDM_TEMPLATE_INTERNAL_NAME")) || SENDDM_TEMPLATE_INTERNAL_NAME;

    if (!apiKey) throw new Error("SENDDM_API_KEY em falta.");
    if (!modelId) throw new Error("SENDDM_MODEL_ID em falta.");

    const templateParameters = buildSendDmTemplateParameterObject(input.templateVariables);
    const validation = validateSendDmTemplateParameters(
      SENDDM_BOOKING_CONFIRMATION_PARAMETERS,
      templateParameters,
    );
    const payload = {
      to: [input.to],
      channel: ["whatsapp"],
      ...(senderId ? { from: senderId } : {}),
      template: {
        id: modelId,
        parameters: templateParameters,
      },
      metadata: {
        source: "bellza",
        modelId,
        whatsappTemplateId: whatsappTemplateId || undefined,
        internalTemplate,
        approvedTemplate: templateName,
        messageKind: input.messageKind ?? "confirmation",
        appointmentId: input.appointmentId ?? undefined,
        orderId: input.orderId,
        reservationUrl: input.reservationUrl,
      },
    };
    const requestLogPayload = sanitizeSendDmRequestPayload(payload);
    const templateAudit = {
      template_id: modelId,
      template_name: internalTemplate,
      approved_template: templateName,
      whatsapp_template_id: whatsappTemplateId || null,
      language,
      message_kind: input.messageKind ?? "confirmation",
      expected_parameter_count: SENDDM_BOOKING_CONFIRMATION_PARAMETERS.length,
      sent_parameter_count: Object.keys(templateParameters).length,
      expected_parameters: [...SENDDM_BOOKING_CONFIRMATION_PARAMETERS],
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
            expectedParameterCount: SENDDM_BOOKING_CONFIRMATION_PARAMETERS.length,
            sentParameterCount: Object.keys(templateParameters).length,
            expectedParameters: [...SENDDM_BOOKING_CONFIRMATION_PARAMETERS],
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
        message_id: readProviderMessageId(responsePayload),
        delivery_status: readProviderStatus(responsePayload),
        error: response.ok ? null : readProviderError(responsePayload),
      });
      if (!response.ok) {
        const detail = readProviderError(responsePayload) || response.statusText;
        throw new WhatsAppDeliveryError({
          message: `senddm_http_${response.status}: ${detail}`,
          messageId: readProviderMessageId(responsePayload),
          payload: {
            request: requestLogPayload,
            response: responsePayload ?? { status: response.status, detail },
          },
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      const messageId = readProviderMessageId(responsePayload);
      const finalPayload = messageId ? await refreshSendDmMessageStatus(baseUrl, apiKey, messageId, responsePayload) : responsePayload;
      const finalStatus = readProviderStatus(finalPayload);
      const finalChannel = readProviderChannel(finalPayload);
      const channelMismatch = finalChannel && finalChannel !== "whatsapp"
        ? `senddm_channel_mismatch: expected_whatsapp_received_${finalChannel}`
        : null;
      const unresolvedButtonVariable = readUnresolvedSendDmButtonVariable(finalPayload);
      const contactDiagnostics = isFailedSendDmStatus(finalStatus)
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
        error:
          channelMismatch ||
          readSendDmWhatsAppChannelError(contactDiagnostics) ||
          readProviderError(finalPayload) ||
          unresolvedButtonVariable ||
          null,
        contact: contactDiagnostics,
        payload: {
          request: requestLogPayload,
          response: finalPayload,
        },
      });
      if (isFailedSendDmStatus(finalStatus)) {
        const channelError = readSendDmWhatsAppChannelError(contactDiagnostics);
        throw new WhatsAppDeliveryError({
          message: channelError || `senddm_delivery_failed: ${readProviderError(finalPayload) || "provider_failed"}`,
          messageId,
          payload: {
            request: requestLogPayload,
            response: finalPayload,
            contact: contactDiagnostics,
          },
          retryable: false,
        });
      }
      if (channelMismatch) {
        throw new WhatsAppDeliveryError({
          message: channelMismatch,
          messageId,
          payload: {
            request: requestLogPayload,
            response: finalPayload,
          },
          retryable: false,
        });
      }
      if (unresolvedButtonVariable) {
        console.warn("[whatsapp] senddm_button_parameter_unresolved", {
          template_name: internalTemplate,
          approved_template: templateName,
          recipient: maskPhoneForLog(input.to),
          appointment_id: input.appointmentId ?? null,
          order_id: input.orderId,
          message_id: messageId,
          delivery_status: finalStatus,
          delivery_channel: finalChannel,
          reason: unresolvedButtonVariable,
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

  constructor(input: { message: string; messageId: string | null; payload: unknown; retryable?: boolean }) {
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
    const baseUrl = ((await getServerEnv("RESEND_API_BASE_URL")) || "https://api.resend.com").replace(/\/$/, "");
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

  constructor(input: { message: string; messageId: string | null; payload: unknown; retryable?: boolean }) {
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

async function refreshSendDmMessageStatus(baseUrl: string, apiKey: string, messageId: string, fallback: unknown) {
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
      const status = String(readProviderStatus(lastPayload) || "").toUpperCase();
      if (["DELIVERED", "FAILED", "UNDELIVERED", "CANCELLED", "CANCELED"].includes(status)) {
        return lastPayload;
      }
    } catch {
      continue;
    }
  }

  return lastPayload;
}

async function loadSendDmContactDiagnostics(baseUrl: string, apiKey: string, payload: any) {
  const contactId = payload?.data?.contact_id;
  if (!contactId) return null;
  try {
    const response = await fetch(`${baseUrl}/v3/contacts/${encodeURIComponent(String(contactId))}`, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    });
    if (!response.ok) return { contact_id: String(contactId), lookup_status: response.status };
    const contact = await response.json().catch(() => null);
    return sanitizeSendDmContactPayload(contact);
  } catch {
    return { contact_id: String(contactId), lookup_status: "failed" };
  }
}

function readProviderMessageId(payload: any) {
  return (
    payload?.id ??
    payload?.message_id ??
    payload?.messageId ??
    payload?.data?.id ??
    payload?.data?.recipients?.[0]?.message_id ??
    null
  );
}

function readProviderStatus(payload: any) {
  return payload?.status ?? payload?.message_status ?? payload?.data?.status ?? null;
}

function readProviderChannel(payload: any) {
  const channel = payload?.channel ?? payload?.data?.channel ?? null;
  return typeof channel === "string" ? channel.trim().toLowerCase() : null;
}

function isFailedSendDmStatus(status: unknown) {
  return ["FAILED", "UNDELIVERED", "CANCELLED", "CANCELED"].includes(String(status || "").toUpperCase());
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

function readUnresolvedSendDmButtonVariable(payload: any) {
  const buttons = payload?.data?.message_body?.buttons;
  if (!Array.isArray(buttons)) return "";
  const unresolved = buttons
    .map((button: any) => String(button?.value ?? ""))
    .find((value: string) => /\{\{[^}]+\}\}/.test(value));
  return unresolved ? `button_url_contains_unresolved_variable:${unresolved}` : "";
}

function readProviderError(payload: any) {
  const failedEvent = payload?.data?.events?.find?.((event: any) =>
    String(event?.status ?? event?.type ?? "").toUpperCase().includes("FAILED"),
  );
  return (
    payload?.message ??
    payload?.error?.message ??
    payload?.error ??
    payload?.error_message ??
    payload?.data?.error ??
    failedEvent?.description ??
    failedEvent?.message ??
    failedEvent?.reason ??
    ""
  );
}

function readEmailProviderMessageId(payload: any) {
  return payload?.id ?? payload?.data?.id ?? payload?.message_id ?? payload?.messageId ?? null;
}

function readEmailProviderError(payload: any) {
  return payload?.message ?? payload?.error?.message ?? payload?.error ?? payload?.error_message ?? "";
}

async function isEmailNotificationsEnabled() {
  const value = ((await getServerEnv("EMAIL_NOTIFICATIONS_ENABLED")) || "true").toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function buildEmailSubject(ctx: ConfirmationContext) {
  if (ctx.messageKind === "reschedule") {
    return `${EMAIL_SUBJECT_PREFIX}: reserva remarcada para ${formatEmailDateTime(ctx.startsAt, ctx.studioTimezone)}`;
  }
  if (ctx.messageKind === "cancellation") {
    return `${EMAIL_SUBJECT_PREFIX}: reserva cancelada`;
  }
  return `${EMAIL_SUBJECT_PREFIX}: reserva confirmada para ${formatEmailDateTime(ctx.startsAt, ctx.studioTimezone)}`;
}

function buildBookingConfirmationEmail(ctx: ConfirmationContext, renderedMessage: string) {
  const variables = buildTemplateVariables(ctx);
  const studioName = escapeHtml(ctx.studioName || "Bellza");
  const clientName = escapeHtml(ctx.clientName || "Cliente");
  const serviceName = escapeHtml(ctx.serviceName || "Servico");
  const staffName = escapeHtml(ctx.staffName || "Profissional");
  const date = escapeHtml(variables.data);
  const time = escapeHtml(variables.hora);
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
  const preheader = escapeHtml(`${heading} para ${variables.data} as ${variables.hora}.`);
  const text = [
    `Ola, ${ctx.clientName || "Cliente"}.`,
    "",
    "A sua reserva foi confirmada.",
    `Data: ${variables.data}`,
    `Hora: ${variables.hora}`,
    `Servico: ${ctx.serviceName}`,
    `Profissional: ${ctx.staffName}`,
    "",
    ctx.bookingUrl ? `Ver reserva: ${ctx.bookingUrl}` : "",
    "",
    "Obrigado, Bellza.",
  ].filter(Boolean).join("\n");

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
                <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#d9b98f;font-weight:700;">Bellza</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;font-weight:800;">${escapeHtml(heading)}</h1>
                <p style="margin:10px 0 0;color:#e8dfd6;font-size:15px;line-height:1.55;">${studioName} confirmou a sua marcação.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Olá, <strong>${clientName}</strong>.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
                  ${emailDetailRow("Data", date)}
                  ${emailDetailRow("Hora", time)}
                  ${emailDetailRow("Servico", serviceName)}
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
                Este e-mail foi enviado automaticamente pela Bellza como confirmação da sua marcação.
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
  const email = String(value ?? "").trim().toLowerCase();
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
      .select("id,appointment_id,client_name,client_phone,client_email,starts_at,service_ids,staff_id")
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
      .select("services(name)")
      .eq("appointment_id", appointmentId);
    serviceName = joinServiceNames(lines) || serviceName;
  } else if (bookingRequest?.service_ids?.length) {
    const { data: services } = await sb
      .from("services")
      .select("name")
      .in("id", bookingRequest.service_ids);
    serviceName = (services ?? []).map((service: any) => service.name).filter(Boolean).join(", ");
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

async function loadAppointmentConfirmationContext(sb: any, appointmentId: string): Promise<ConfirmationContext | null> {
  const { data: appt, error } = await sb
    .from("appointments")
    .select(
      "id,studio_id,starts_at,total_price,clients(name,phone,email),staff(name),studios(id,name,timezone,whatsapp_auto_send_enabled,whatsapp_default_message)",
    )
    .eq("id", appointmentId)
    .maybeSingle();
  if (error || !appt?.id) return null;

  const { data: lines } = await sb
    .from("appointment_services")
    .select("services(name)")
    .eq("appointment_id", appointmentId);

  return {
    studioId: appt.studio_id,
    studioName: appt.studios?.name ?? "Estudio",
    appointmentId,
    paymentRowId: `appointment-${appointmentId}`,
    paymentIntentId: `appointment-${appointmentId}`,
    clientName: appt.clients?.name ?? "Cliente",
    clientPhone: appt.clients?.phone ?? "",
    clientEmail: appt.clients?.email ?? null,
    serviceName: joinServiceNames(lines) || "Serviço",
    staffName: appt.staff?.name ?? "Profissional",
    startsAt: appt.starts_at,
    studioTimezone: appt.studios?.timezone ?? "Europe/Lisbon",
    paidAmount: 0,
    currency: "eur",
    template: appt.studios?.whatsapp_default_message ?? DEFAULT_TEMPLATE,
    autoEnabled: Boolean(appt.studios?.whatsapp_auto_send_enabled),
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
    String(full.error?.message ?? "").toLowerCase().includes("whatsapp_");

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
    fromNumber: process.env.SENDDM_WHATSAPP_SENDER_ID || "",
    lastError: null,
  };
}

function renderMessage(template: string, ctx: ConfirmationContext) {
  const variables = buildTemplateVariables(ctx);
  const legacyVariables: Record<string, string> = {
    nome_cliente: variables.nomeCliente,
    "serviço": variables.servico,
    valor_sinal: formatMoney(ctx.paidAmount, ctx.currency),
    nome_estudio: ctx.studioName,
    "nome_estúdio": ctx.studioName,
    link_agendamento: ctx.bookingUrl,
    reservationToken: ctx.bookingUrl,
  };
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const normalizedKey = key.trim();
    return variables[normalizedKey as keyof WhatsAppTemplateVariables] ?? legacyVariables[normalizedKey] ?? "";
  });
}

function buildTemplateVariables(ctx: ConfirmationContext): WhatsAppTemplateVariables {
  return {
    nomeCliente: toSendDmTemplateText(ctx.clientName, "Cliente"),
    data: formatStudioDate(ctx.startsAt, ctx.studioTimezone),
    hora: formatStudioTime(ctx.startsAt, ctx.studioTimezone),
    servico: toSendDmTemplateText(ctx.serviceName, "Servico"),
    profissional: toSendDmTemplateText(ctx.staffName || ctx.studioName, ctx.studioName || "Estudio"),
    orderId: toSendDmTemplateText(publicOrderIdFromUrl(ctx.bookingUrl), "reserva"),
  };
}

function buildSendDmTemplateParameterObject(variables: WhatsAppTemplateVariables) {
  return Object.fromEntries(
    SENDDM_BOOKING_CONFIRMATION_PARAMETERS.map((name) => [name, variables[name]]),
  ) as Record<(typeof SENDDM_BOOKING_CONFIRMATION_PARAMETERS)[number], string>;
}

function validateSendDmTemplateParameters(
  expectedParameters: readonly string[],
  sentParameters: Record<string, unknown>,
) {
  const sentKeys = Object.keys(sentParameters);
  const parameterState = expectedParameters.map((name, index) => {
    const value = sentParameters[name];
    return {
      index: index + 1,
      name,
      hasValue: typeof value === "string" && value.trim().length > 0,
      length: typeof value === "string" ? value.trim().length : 0,
    };
  });

  if (sentKeys.length !== expectedParameters.length) {
    return {
      ok: false,
      reason: `expected_${expectedParameters.length}_parameters_received_${sentKeys.length}`,
      parameterState,
    };
  }

  const expectedSet = new Set(expectedParameters);
  const extra = sentKeys.filter((key) => !expectedSet.has(key));
  const missingKeys = expectedParameters.filter((key) => !Object.prototype.hasOwnProperty.call(sentParameters, key));
  if (extra.length > 0 || missingKeys.length > 0) {
    return {
      ok: false,
      reason: `parameter_keys_mismatch_missing_${missingKeys.join(",") || "none"}_extra_${extra.join(",") || "none"}`,
      parameterState,
    };
  }

  const missing = parameterState.filter((param) => !param.hasValue);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `empty_parameters_${missing.map((param) => `${param.index}:${param.name}`).join(",")}`,
      parameterState,
    };
  }

  return { ok: true, reason: null, parameterState };
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

async function loadLatestAppointmentPublicUrlForStudio(sb: any, studioId: string) {
  const { data, error } = await sb
    .from("appointments")
    .select("id")
    .eq("studio_id", studioId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) {
    throw new Error("Crie uma marcação antes de enviar o teste, para que o botão use um link real da reserva.");
  }
  return ensureAppointmentPublicUrl(sb, data.id);
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
  if (ctx.paymentRowId && ctx.paymentRowId !== "test" && !ctx.paymentRowId.startsWith("appointment-")) {
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
      payment_intent_id: ctx.paymentRowId === "test" || ctx.paymentRowId.startsWith("appointment-") ? null : ctx.paymentRowId,
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
      payment_intent_id: ctx.paymentRowId === "test" || ctx.paymentRowId.startsWith("appointment-") ? null : ctx.paymentRowId,
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
