import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess, rateLimitOrThrow } from "@/lib/server-security";

const DEFAULT_TEMPLATE =
  "Olá, {nome_cliente}. Confirmamos a sua marcação de {serviço} com {profissional} para {data} às {hora}.\n\nPode consultar os detalhes, remarcar, cancelar ou solicitar reembolso pelo link abaixo:\n{link_agendamento}";

type WhatsAppSendInput = {
  to: string;
  body: string;
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

type ConfirmationContext = {
  studioId: string;
  studioName: string;
  appointmentId: string | null;
  paymentRowId: string;
  paymentIntentId: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  staffName: string;
  startsAt: string;
  paidAmount: number;
  currency: string;
  template: string;
  autoEnabled: boolean;
  bookingUrl: string;
};

let _admin: ReturnType<typeof createClient> | null = null;
function admin(): any {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

export const getWhatsAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertStudioAccess(sb, (context as any).userId, data.studioId);
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
    await assertStudioAccess(sb, (context as any).userId, data.studioId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof data.autoSendEnabled === "boolean") {
      patch.whatsapp_auto_send_enabled = data.autoSendEnabled;
    }
    if (data.messageTemplate) patch.whatsapp_default_message = data.messageTemplate;
    const { error } = await sb.from("studios").update(patch).eq("id", data.studioId);
    if (isMissingWhatsAppSchema(error)) {
      throw new Error(
        "A configuração de WhatsApp ainda não foi aplicada no banco. Aplique a migration Twilio WhatsApp e recarregue o schema do Supabase.",
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
    await assertStudioAccess(sb, userId, data.studioId);
    await rateLimitOrThrow({
      key: `whatsapp-test:${userId}:${data.studioId}`,
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });
    const studio = await loadStudioWhatsApp(sb, data.studioId);
    const to = normalizeWhatsAppPhone(data.phone);
    if (!to) throw new Error("Telefone invalido para WhatsApp.");

    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ctx: ConfirmationContext = {
      studioId: studio.id,
      studioName: studio.name ?? "Estúdio",
      appointmentId: null,
      paymentRowId: "test",
      paymentIntentId: "test",
      clientName: "Cliente teste",
      clientPhone: to,
      serviceName: "Servico teste",
      staffName: "Profissional",
      startsAt,
      paidAmount: 10,
      currency: "eur",
      template: studio.whatsapp_default_message ?? DEFAULT_TEMPLATE,
      autoEnabled: true,
      bookingUrl: `${getOrigin()}/marcacao/teste`,
    };
    const result = await getWhatsAppProvider().sendText({
      to,
      body: renderMessage(ctx.template, ctx),
    });
    return { ok: true, messageId: result.messageId ?? null };
  });

export async function sendAppointmentConfirmationMessage(
  sb: any,
  input: { stripePaymentIntentId?: string; paymentIntentId?: string },
) {
  const ctx = await loadConfirmationContext(sb, input);
  if (!ctx) return null;

  const idempotencyKey = `twilio-whatsapp-payment-${ctx.paymentRowId}`;
  return sendConfirmationFromContext(sb, ctx, idempotencyKey);
}

export const sendAppointmentConfirmationForAppointment = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ appointmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = admin();
    const ctx = await loadAppointmentConfirmationContext(sb, data.appointmentId);
    if (!ctx) return null;
    return sendConfirmationFromContext(sb, ctx, `twilio-whatsapp-appointment-${data.appointmentId}`);
  });

async function sendConfirmationFromContext(sb: any, ctx: ConfirmationContext, idempotencyKey: string) {
  const existing = await findExistingLog(sb, idempotencyKey);
  if (existing?.status === "sent" || existing?.status === "pending") return existing;

  const rendered = renderMessage(ctx.template || DEFAULT_TEMPLATE, ctx);
  const recipient = normalizeWhatsAppPhone(ctx.clientPhone);

  if (!ctx.autoEnabled) {
    return insertLog(sb, ctx, idempotencyKey, {
      status: "skipped",
      reason: "auto_send_disabled",
      message: rendered,
      recipientPhone: recipient,
      provider: "twilio_whatsapp_sandbox",
    });
  }
  if (!recipient) {
    return insertLog(sb, ctx, idempotencyKey, {
      status: "skipped",
      reason: "invalid_phone",
      message: rendered,
      recipientPhone: ctx.clientPhone || null,
      provider: "twilio_whatsapp_sandbox",
    });
  }

  const pending =
    existing ??
    (await insertLog(sb, ctx, idempotencyKey, {
      status: "pending",
      reason: null,
      message: rendered,
      recipientPhone: recipient,
      provider: "twilio_whatsapp_sandbox",
    }));
  if (!pending) return findExistingLog(sb, idempotencyKey);
  if (existing) {
    await updateLog(sb, existing.id, {
      status: "pending",
      reason: null,
      message: rendered,
      recipient_phone: recipient,
      provider: "twilio_whatsapp_sandbox",
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
    const sent = await getWhatsAppProvider().sendText({ to: recipient, body: rendered });
    return updateLog(sb, pending.id, {
      status: "sent",
      reason: null,
      provider: sent.provider,
      provider_message_id: sent.messageId,
      payload: sent.payload,
    });
  } catch (error) {
    const twilioError = error instanceof TwilioDeliveryError ? error : null;
    return updateLog(sb, pending.id, {
      status: "failed",
      reason: error instanceof Error ? error.message : "whatsapp_send_failed",
      provider_message_id: twilioError?.messageId ?? null,
      payload: twilioError?.payload ?? { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

function getWhatsAppProvider(): WhatsAppProvider {
  return createTwilioWhatsAppProvider();
}

function createTwilioWhatsAppProvider(): WhatsAppProvider {
  return {
    name: "twilio_whatsapp_sandbox",
    async sendText(input) {
      const accountSid = await getServerEnv("TWILIO_ACCOUNT_SID");
      const authToken = await getServerEnv("TWILIO_AUTH_TOKEN");
      const from = (await getServerEnv("TWILIO_WHATSAPP_NUMBER")) || "whatsapp:+14155238886";
      if (!accountSid) throw new Error("TWILIO_ACCOUNT_SID em falta.");
      if (!authToken) throw new Error("TWILIO_AUTH_TOKEN em falta.");

      const body = new URLSearchParams({
        From: from,
        To: input.to,
        Body: input.body,
      });

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${encodeBasicAuth(`${accountSid}:${authToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          typeof payload?.message === "string"
            ? payload.message
            : typeof payload?.error_message === "string"
              ? payload.error_message
            : response.statusText;
        throw new Error(`twilio_http_${response.status}: ${detail}`);
      }
      const finalPayload = await refreshTwilioMessageStatus(accountSid, authToken, payload);
      const deliveryStatus =
        typeof finalPayload?.status === "string"
          ? finalPayload.status
          : typeof payload?.status === "string"
            ? payload.status
            : null;
      if (deliveryStatus === "failed" || deliveryStatus === "undelivered") {
        const code = finalPayload?.error_code ?? payload?.error_code ?? "unknown";
        const message =
          finalPayload?.error_message ||
          payload?.error_message ||
          twilioErrorHint(String(code)) ||
          deliveryStatus;
        throw new TwilioDeliveryError({
          message: `twilio_${deliveryStatus}_${code}: ${message}`,
          messageId: finalPayload?.sid ?? payload?.sid ?? null,
          payload: finalPayload ?? payload,
        });
      }
      return {
        provider: "twilio_whatsapp_sandbox",
        messageId: finalPayload?.sid ?? payload?.sid ?? null,
        deliveryStatus,
        payload: finalPayload ?? payload,
      };
    },
  };
}

class TwilioDeliveryError extends Error {
  messageId: string | null;
  payload: unknown;

  constructor(input: { message: string; messageId: string | null; payload: unknown }) {
    super(input.message);
    this.name = "TwilioDeliveryError";
    this.messageId = input.messageId;
    this.payload = input.payload;
  }
}

async function getServerEnv(name: string) {
  return process.env[name] ?? "";
}

async function refreshTwilioMessageStatus(accountSid: string, authToken: string, payload: any) {
  const sid = payload?.sid;
  const status = payload?.status;
  if (!sid || !["accepted", "queued", "sending"].includes(status)) return payload;

  await new Promise((resolve) => setTimeout(resolve, 1800));
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(sid)}.json`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(`${accountSid}:${authToken}`)}`,
      },
    },
  );
  if (!response.ok) return payload;
  return response.json().catch(() => payload);
}

function twilioErrorHint(code: string) {
  if (code === "63015") {
    return "O número de destino ainda não entrou no Twilio WhatsApp Sandbox.";
  }
  return "";
}

function encodeBasicAuth(value: string) {
  if (typeof Buffer !== "undefined") return Buffer.from(value).toString("base64");
  return btoa(value);
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
      .select("id,appointment_id,client_name,client_phone,starts_at,service_ids,staff_id")
      .eq("id", payment.booking_request_id)
      .maybeSingle();
    bookingRequest = data;
    appointmentId = (data?.appointment_id as string | null) ?? null;
  }

  const studio = await loadStudioWhatsApp(sb, payment.studio_id as string);
  let clientName = bookingRequest?.client_name ?? "Cliente";
  let clientPhone = bookingRequest?.client_phone ?? "";
  let serviceName = "Servico";
  let staffName = "Profissional";
  let startsAt = bookingRequest?.starts_at ?? new Date().toISOString();

  if (appointmentId) {
    const { data: appt } = await sb
      .from("appointments")
      .select("id,starts_at,clients(name,phone),staff(name)")
      .eq("id", appointmentId)
      .maybeSingle();
    clientName = appt?.clients?.name ?? clientName;
    clientPhone = appt?.clients?.phone ?? clientPhone;
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
    serviceName: serviceName || "Servico",
    staffName,
    startsAt,
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
      "id,studio_id,starts_at,total_price,clients(name,phone),staff(name),studios(id,name,whatsapp_auto_send_enabled,whatsapp_default_message)",
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
    serviceName: joinServiceNames(lines) || "Servico",
    staffName: appt.staff?.name ?? "Profissional",
    startsAt: appt.starts_at,
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
    .select("id,name,whatsapp_auto_send_enabled,whatsapp_default_message")
    .eq("id", studioId)
    .maybeSingle();
  if (!full.error && full.data) return withWhatsAppDefaults(full.data);

  const missingWhatsAppColumns =
    isMissingWhatsAppSchema(full.error) ||
    String(full.error?.message ?? "").toLowerCase().includes("whatsapp_");

  if (full.error && !missingWhatsAppColumns) {
    throw new Error(full.error.message);
  }

  const base = await sb.from("studios").select("id,name").eq("id", studioId).maybeSingle();
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
    provider: "twilio_whatsapp_sandbox",
    sandboxNumber: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
    lastError: null,
  };
}

function renderMessage(template: string, ctx: ConfirmationContext) {
  const when = new Date(ctx.startsAt);
  const params: Record<string, string> = {
    nome_cliente: ctx.clientName,
    servico: ctx.serviceName,
    serviço: ctx.serviceName,
    profissional: ctx.staffName,
    data: when.toLocaleDateString("pt-PT"),
    hora: when.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }),
    valor_sinal: formatMoney(ctx.paidAmount, ctx.currency),
    nome_estudio: ctx.studioName,
    nome_estúdio: ctx.studioName,
    link_agendamento: ctx.bookingUrl,
  };
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => params[key] ?? "");
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
  if (digits.startsWith("00")) return `whatsapp:+${digits.slice(2)}`;
  if (cleaned.startsWith("+")) return `whatsapp:+${digits}`;
  if (digits.startsWith("351")) return `whatsapp:+${digits}`;
  if (digits.length === 9) return `whatsapp:+351${digits}`;
  return `whatsapp:+${digits}`;
}

function formatMoney(value: number, currency = "eur") {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value || 0);
}

function getOrigin() {
  const origin = process.env.PUBLIC_APP_URL || process.env.APP_URL || "";
  return origin.replace(/\/$/, "") || "http://localhost:8081";
}

async function ensureAppointmentPublicUrl(sb: any, appointmentId: string) {
  const token = await ensureAppointmentPublicToken(sb, appointmentId);
  return `${getOrigin()}/marcacao/${token}`;
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
