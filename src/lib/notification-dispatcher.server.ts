import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { sendWebPush } from "@/lib/web-push.server";

const SyncStudioPushInput = z.object({
  studioId: z.string().uuid(),
});

const DispatchRecentStudioAppointmentInput = z.object({
  studioId: z.string().uuid(),
  appointmentId: z.string().uuid(),
});

type ClaimedDelivery = {
  delivery_id: string;
  notification_id: string;
  studio_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  action_url: string | null;
  payload: Record<string, unknown> | null;
  attempt_count: number;
};

const CLAIM_BATCH_SIZE = 100;
const MAX_DELIVERY_ATTEMPTS = 12;

export const syncStudioPushNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SyncStudioPushInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("Unauthorized", { status: 401 });

    const sb = getAdminClient();
    await assertCanAccessStudio(sb, userId, data.studioId);
    return dispatchPendingStudioPushNotifications({ studioId: data.studioId });
  });

export const dispatchRecentStudioAppointmentPushNotification = createServerFn({ method: "POST" })
  .inputValidator((input) => DispatchRecentStudioAppointmentInput.parse(input))
  .handler(async ({ data }) => {
    const sb = getAdminClient();
    const appointment = await loadRecentAppointmentForDispatch(sb, data.studioId, data.appointmentId);
    if (!appointment) {
      console.info("[notifications] studio_push_recent_skipped", {
        studio_id: data.studioId,
        appointment_id: data.appointmentId,
        reason: "appointment_missing_or_old",
      });
      return { sent: 0, failed: 0, retried: 0, skipped: 1 };
    }

    return dispatchPendingStudioPushNotifications({
      studioId: data.studioId,
      appointmentId: data.appointmentId,
    });
  });

export async function dispatchPendingStudioPushNotifications(options?: {
  studioId?: string;
  appointmentId?: string;
  notificationId?: string;
}) {
  const sb = getAdminClient();
  await cleanupExpiredPushSubscriptions(sb, options?.studioId);
  await cleanupExcessStudioPushSubscriptions(sb, options?.studioId);

  let sent = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;

  for (let batch = 0; batch < 5; batch += 1) {
    const { data, error } = await (sb as any).rpc("claim_studio_notification_deliveries", {
      p_limit: CLAIM_BATCH_SIZE,
      p_studio_id: options?.studioId ?? null,
      p_notification_id: options?.notificationId ?? null,
    });
    if (error) throw new Error(error.message);

    const deliveries = ((data ?? []) as ClaimedDelivery[]).filter(
      (item) =>
        item.delivery_id &&
        item.notification_id &&
        item.studio_id &&
        item.subscription_id &&
        item.endpoint,
    );
    if (deliveries.length === 0) break;

    const results = await Promise.all(deliveries.map((delivery) => deliverStudioPush(sb, delivery)));
    sent += results.filter((result) => result === "sent").length;
    failed += results.filter((result) => result === "failed").length;
    retried += results.filter((result) => result === "retry").length;
    skipped += results.filter((result) => result === "skipped").length;

    if (deliveries.length < CLAIM_BATCH_SIZE) break;
  }

  return { sent, failed, retried, skipped };
}

async function deliverStudioPush(
  sb: ReturnType<typeof getAdminClient>,
  delivery: ClaimedDelivery,
): Promise<"sent" | "failed" | "retry" | "skipped"> {
  const scope = await validateStudioNotificationScope(sb, delivery);
  if (!scope.ok) {
    await finalizeDelivery(sb, delivery, {
      status: "skipped",
      error: scope.reason,
    });
    await logDeliveryAttempt(sb, delivery, "skipped", scope.reason);
    return "skipped";
  }

  const title = sanitizeStudioNotificationText(
    delivery.title,
    studioPushFallbackTitle(delivery.kind),
  );
  const body = sanitizeStudioNotificationText(
    delivery.body,
    studioPushFallbackBody(delivery.kind),
  );
  const actionUrl = sanitizeActionUrl(delivery.action_url, delivery.kind);

  try {
    const result = await sendWebPush(delivery, {
      title: "Bellza",
      body: formatPushBody(title, body),
      url: actionUrl,
      icon: "/pwa-icon.svg",
      badge: "/pwa-icon.svg",
      tag: `studio-${delivery.notification_id}`,
      data: {
        kind: delivery.kind,
        studioId: delivery.studio_id,
        notificationId: delivery.notification_id,
        deliveryId: delivery.delivery_id,
        receiptToken: readPayloadString(delivery.payload, "delivery_receipt_token"),
        url: actionUrl,
      },
    });

    if (result.ok) {
      await finalizeDelivery(sb, delivery, { status: "sent" });
      await logDeliveryAttempt(sb, delivery, "sent");
      console.info("[notifications] studio_push_accepted", {
        studio_id: delivery.studio_id,
        notification_id: delivery.notification_id,
        delivery_id: delivery.delivery_id,
        attempt: delivery.attempt_count,
      });
      return "sent";
    }

    const reason = webPushFailureReason(result);
    const terminal =
      "status" in result &&
      (result.status === 400 || result.status === 401 || result.status === 403 ||
        result.status === 404 || result.status === 410);
    const invalidSubscription =
      "status" in result &&
      (result.status === 400 || result.status === 404 || result.status === 410);
    const exhausted = delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS;
    const status = terminal || exhausted ? "failed" : "retry";

    await finalizeDelivery(sb, delivery, { status, error: reason });
    await logDeliveryAttempt(sb, delivery, status, reason);

    if (invalidSubscription) {
      await revokePushSubscription(sb, delivery.subscription_id, reason);
    }
    return status;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "send_exception";
    const status = delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS ? "failed" : "retry";
    await finalizeDelivery(sb, delivery, { status, error: reason });
    await logDeliveryAttempt(sb, delivery, status, reason);
    console.error("[notifications] studio_push_exception", {
      studio_id: delivery.studio_id,
      notification_id: delivery.notification_id,
      delivery_id: delivery.delivery_id,
      attempt: delivery.attempt_count,
      reason,
    });
    return status;
  }
}

async function finalizeDelivery(
  sb: ReturnType<typeof getAdminClient>,
  delivery: ClaimedDelivery,
  result: { status: "sent" | "failed" | "retry" | "skipped"; error?: string },
) {
  const now = new Date();
  const patch: Record<string, unknown> = {
    status: result.status,
    lease_until: null,
    last_error: result.error ?? null,
    updated_at: now.toISOString(),
  };
  if (result.status === "sent") {
    patch.accepted_at = now.toISOString();
  }
  if (result.status === "retry") {
    patch.next_attempt_at = new Date(
      now.getTime() + retryDelayMs(delivery.attempt_count),
    ).toISOString();
  }

  const { error } = await (sb as any)
    .from("studio_notification_deliveries")
    .update(patch)
    .eq("id", delivery.delivery_id)
    .eq("studio_id", delivery.studio_id)
    .eq("status", "delivering");
  if (error) throw new Error(error.message);
}

async function logDeliveryAttempt(
  sb: ReturnType<typeof getAdminClient>,
  delivery: ClaimedDelivery,
  status: string,
  error?: string,
) {
  const { error: logError } = await (sb as any).from("notifications_log").insert({
    studio_id: delivery.studio_id,
    appointment_id: readPayloadString(delivery.payload, "appointment_id"),
    channel: "push_studio",
    kind: delivery.kind,
    recipient: `user:${delivery.user_id}`,
    payload: {
      event: "studio_notification_push",
      studio_notification_id: delivery.notification_id,
      delivery_id: delivery.delivery_id,
      subscription_id: delivery.subscription_id,
      endpoint: maskEndpoint(delivery.endpoint),
      attempt: delivery.attempt_count,
    },
    status,
    error: error ?? null,
  });
  if (logError) {
    console.error("[notifications] delivery_log_failed", {
      delivery_id: delivery.delivery_id,
      reason: logError.message,
    });
  }
}

async function validateStudioNotificationScope(
  sb: ReturnType<typeof getAdminClient>,
  notification: ClaimedDelivery,
) {
  const { data: currentMembership, error: membershipError } = await (sb as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", notification.user_id)
    .eq("studio_id", notification.studio_id)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!currentMembership?.role) {
    return { ok: false as const, reason: "subscription_user_not_studio_member" };
  }

  const payloadStudioId = readPayloadString(notification.payload, "studio_id");
  if (payloadStudioId && payloadStudioId !== notification.studio_id) {
    return { ok: false as const, reason: "payload_studio_mismatch" };
  }

  const checks: Array<{
    payloadKey: string;
    table: string;
    missing: string;
    mismatch: string;
  }> = [
    {
      payloadKey: "appointment_id",
      table: "appointments",
      missing: "appointment_missing",
      mismatch: "appointment_studio_mismatch",
    },
    {
      payloadKey: "booking_request_id",
      table: "booking_payment_requests",
      missing: "booking_request_missing",
      mismatch: "booking_request_studio_mismatch",
    },
    {
      payloadKey: "client_id",
      table: "clients",
      missing: "client_missing",
      mismatch: "client_studio_mismatch",
    },
    {
      payloadKey: "review_id",
      table: "studio_reviews",
      missing: "review_missing",
      mismatch: "review_studio_mismatch",
    },
  ];

  for (const check of checks) {
    const id = readPayloadString(notification.payload, check.payloadKey);
    if (!id) continue;
    const { data, error } = await (sb as any)
      .from(check.table)
      .select("id,studio_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.id) return { ok: false as const, reason: check.missing };
    if (data.studio_id !== notification.studio_id) {
      return { ok: false as const, reason: check.mismatch };
    }
  }

  return { ok: true as const };
}

async function loadRecentAppointmentForDispatch(
  sb: ReturnType<typeof getAdminClient>,
  studioId: string,
  appointmentId: string,
) {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("studio_id", studioId)
    .gte("created_at", since)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function cleanupExpiredPushSubscriptions(
  sb: ReturnType<typeof getAdminClient>,
  studioId?: string,
) {
  const now = Date.now();
  let query = (sb as any)
    .from("push_subscriptions")
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: "subscription_expired",
      updated_at: new Date().toISOString(),
    })
    .is("revoked_at", null)
    .not("expiration_time", "is", null)
    .lt("expiration_time", now);
  if (studioId) query = query.eq("studio_id", studioId);
  const { error } = await query;
  if (error) console.warn("push_subscription_expiry_cleanup_failed", error.message);
}

async function cleanupExcessStudioPushSubscriptions(
  sb: ReturnType<typeof getAdminClient>,
  studioId?: string,
) {
  let query = (sb as any)
    .from("push_subscriptions")
    .select("id,user_id,studio_id,updated_at")
    .in("audience", ["studio", "both"])
    .is("revoked_at", null)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (studioId) query = query.eq("studio_id", studioId);

  const { data, error } = await query;
  if (error) {
    console.warn("push_subscription_excess_cleanup_failed", error.message);
    return;
  }

  const keepCountByKey = new Map<string, number>();
  const revokeIds: string[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    user_id: string;
    studio_id: string | null;
  }>) {
    if (!row.id || !row.user_id || !row.studio_id) continue;
    const key = `${row.studio_id}:${row.user_id}`;
    const count = keepCountByKey.get(key) ?? 0;
    if (count >= 12) revokeIds.push(row.id);
    else keepCountByKey.set(key, count + 1);
  }
  if (revokeIds.length === 0) return;

  const { error: updateError } = await (sb as any)
    .from("push_subscriptions")
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: "device_limit_exceeded",
      updated_at: new Date().toISOString(),
    })
    .in("id", revokeIds);
  if (updateError) console.warn("push_subscription_excess_cleanup_update_failed", updateError.message);
}

async function revokePushSubscription(
  sb: ReturnType<typeof getAdminClient>,
  subscriptionId: string,
  reason: string,
) {
  const now = new Date().toISOString();
  const { error } = await (sb as any)
    .from("push_subscriptions")
    .update({ revoked_at: now, revocation_reason: reason, updated_at: now })
    .eq("id", subscriptionId);
  if (error) console.warn("push_subscription_revoke_failed", error.message);
}

async function assertCanAccessStudio(
  sb: ReturnType<typeof getAdminClient>,
  userId: string,
  studioId: string,
) {
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.role) throw new Response("forbidden", { status: 403 });
}

function retryDelayMs(attempt: number) {
  const base = 30_000 * 2 ** Math.max(0, Math.min(attempt - 1, 10));
  return Math.min(base, 6 * 60 * 60 * 1000);
}

function readPayloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function webPushFailureReason(result: Awaited<ReturnType<typeof sendWebPush>>) {
  if ("status" in result) return `web_push_${result.status}`;
  if ("skipped" in result) return result.skipped;
  return "web_push_failed";
}

function sanitizeActionUrl(value: string | null, kind: string) {
  const fallback =
    kind === "payment_confirmed" || kind === "payment_failed" || kind === "withdrawal_requested"
      ? "/admin/recebimento"
      : kind === "new_client" || kind === "new_review"
        ? "/admin/clientes"
        : kind === "refund_request"
          ? "/admin/politicas"
          : kind.includes("appointment")
            ? "/admin/agenda"
            : "/admin";
  if (!value || !value.startsWith("/admin")) return fallback;
  try {
    const parsed = new URL(value, "https://bellza.pt");
    return parsed.origin === "https://bellza.pt" && parsed.pathname.startsWith("/admin")
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

function sanitizeStudioNotificationText(value: string, fallback: string) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const withoutBrowserAttribution = text.replace(/\s+\bfrom\b\s+[\w .:/-]+\s*$/i, "").trim();
  const technicalPattern =
    /\b(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\b|notifications_log|studio_notifications|push_subscriptions|appointment_created|update_professional_status|push_client|push_studio|[_{}[\]"`]/i;
  if (technicalPattern.test(withoutBrowserAttribution)) return fallback;
  return withoutBrowserAttribution || fallback;
}

function studioPushFallbackTitle(kind: string) {
  if (kind === "new_appointment") return "Nova marcação recebida";
  if (kind === "appointment_rescheduled") return "Marcação remarcada";
  if (kind === "appointment_cancelled") return "Marcação cancelada";
  if (kind === "payment_confirmed") return "Pagamento aprovado";
  if (kind === "payment_failed") return "Pagamento não concluído";
  if (kind === "new_client") return "Novo cliente cadastrado";
  if (kind === "new_review") return "Nova avaliação recebida";
  if (kind === "refund_request") return "Pedido de reembolso recebido";
  if (kind === "withdrawal_requested") return "Pedido financeiro recebido";
  return "Notificação do painel";
}

function studioPushFallbackBody(kind: string) {
  if (kind === "new_appointment") return "Tem uma nova marcação para acompanhar no painel.";
  if (kind === "appointment_rescheduled") return "Uma marcação foi remarcada.";
  if (kind === "appointment_cancelled") return "Uma marcação foi cancelada.";
  if (kind === "payment_confirmed") return "Um pagamento foi aprovado.";
  if (kind === "payment_failed") return "Um pagamento precisa de atenção.";
  if (kind === "new_client") return "Um novo cliente foi adicionado ao estúdio.";
  if (kind === "new_review") return "O estúdio recebeu uma nova avaliação.";
  if (kind === "refund_request") return "Existe um pedido de reembolso para analisar.";
  if (kind === "withdrawal_requested") return "Existe uma atualização financeira para analisar.";
  return "Tem uma nova ação importante no painel.";
}

function formatPushBody(title: string, body: string) {
  return [title, body].map((item) => item.trim()).filter(Boolean).join("\n");
}

function maskEndpoint(endpoint: string) {
  return endpoint.length <= 22 ? endpoint : `${endpoint.slice(0, 16)}...${endpoint.slice(-6)}`;
}
