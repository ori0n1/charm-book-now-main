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

type StudioNotificationRow = {
  id: string;
  studio_id: string;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  studio_id: string | null;
  audience: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  updated_at?: string | null;
};

type NotificationLogRow = {
  studio_id: string | null;
  recipient: string;
  status: string;
  payload: Record<string, unknown> | null;
};

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
      return { sent: 0, failed: 0, skipped: 1 };
    }
    console.info("[notifications] studio_push_recent_dispatch", {
      studio_id: data.studioId,
      appointment_id: data.appointmentId,
    });
    return dispatchPendingStudioPushNotifications({
      studioId: data.studioId,
      appointmentId: data.appointmentId,
    });
  });

export async function dispatchPendingStudioPushNotifications(options?: { studioId?: string; appointmentId?: string }) {
  const sb = getAdminClient();
  await cleanupExpiredPushSubscriptions(sb, options?.studioId);
  await cleanupExcessStudioPushSubscriptions(sb, options?.studioId);
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  let query = (sb as any)
    .from("studio_notifications")
    .select("id,studio_id,kind,title,body,payload,created_at")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(100);

  if (options?.studioId) query = query.eq("studio_id", options.studioId);
  if (options?.appointmentId) query = query.contains("payload", { appointment_id: options.appointmentId });

  const { data: notifications, error } = await query;
  if (error) throw new Error(error.message);
  const rows = ((notifications ?? []) as StudioNotificationRow[]).filter((item) => item.id && item.studio_id);
  if (rows.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  const notificationIds = new Set(rows.map((item) => item.id));
  const studioIds = Array.from(new Set(rows.map((item) => item.studio_id).filter(Boolean)));
  const { data: existingLogs, error: logsError } = await (sb as any)
    .from("notifications_log")
    .select("studio_id,recipient,status,payload")
    .eq("channel", "push_studio")
    .in("studio_id", studioIds)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (logsError) throw new Error(logsError.message);

  const dispatchedKeys = new Set<string>();
  for (const log of ((existingLogs ?? []) as NotificationLogRow[])) {
    const notificationId = readPayloadString(log.payload, "studio_notification_id");
    if (!notificationId || !notificationIds.has(notificationId)) continue;
    const notification = rows.find((item) => item.id === notificationId);
    if (!notification || log.studio_id !== notification.studio_id) continue;
    if (log.status === "skipped" && log.recipient.startsWith("studio:")) {
      dispatchedKeys.add(studioPushNoTargetKey(notificationId, log.recipient.replace(/^studio:/, "")));
      continue;
    }
    if (log.status !== "sent") continue;
    const endpoint = readPayloadString(log.payload, "endpoint");
    if (endpoint) dispatchedKeys.add(studioPushDeliveryKey(notificationId, endpoint));
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of rows) {
    console.info("[notifications] studio_push_attempt", {
      studio_id: notification.studio_id,
      notification_id: notification.id,
      kind: notification.kind,
    });
    const scope = await validateStudioNotificationScope(sb, notification);
    if (!scope.ok) {
      const key = studioPushNoTargetKey(notification.id, notification.studio_id);
      if (!dispatchedKeys.has(key)) {
        await insertNotificationLog(sb, {
          studioId: notification.studio_id,
          channel: "push_studio",
          kind: notification.kind,
          recipient: `studio:${notification.studio_id}`,
          status: "skipped",
          error: scope.reason,
          payload: {
            studio_notification_id: notification.id,
            event: "studio_notification_scope_guard",
            appointment_id: readPayloadString(notification.payload, "appointment_id"),
            booking_request_id: readPayloadString(notification.payload, "booking_request_id"),
          },
        });
        dispatchedKeys.add(key);
      }
      skipped += 1;
      continue;
    }

    const targets = await loadStudioPushTargets(sb, notification, dispatchedKeys);

    if (targets.length === 0) {
      const key = studioPushNoTargetKey(notification.id, notification.studio_id);
      if (!dispatchedKeys.has(key)) {
        await insertNotificationLog(sb, {
          studioId: notification.studio_id,
          channel: "push_studio",
          kind: notification.kind,
          recipient: `studio:${notification.studio_id}`,
          status: "skipped",
          error: "no_studio_push_subscription",
          payload: {
            studio_notification_id: notification.id,
            event: "studio_notification_push",
          },
        });
        dispatchedKeys.add(key);
      }
      skipped += 1;
      continue;
    }

    const deliveryResults = await Promise.all(
      targets.map(async (subscription) => {
        const recipient = `user:${subscription.user_id}`;
        const endpoint = maskEndpoint(subscription.endpoint);
        const deliveryKey = studioPushDeliveryKey(notification.id, endpoint);
        const title = sanitizeStudioNotificationText(notification.title, studioPushFallbackTitle(notification.kind));
        const body = sanitizeStudioNotificationText(notification.body, studioPushFallbackBody(notification.kind));
      try {
        const result = await sendWebPush(subscription, {
          title: "Bellza",
          body: formatPushBody(title, body),
          url: "/admin/agenda",
          icon: "/pwa-icon.svg",
          badge: "/pwa-icon.svg",
          tag: `studio-${notification.id}`,
          data: {
            kind: notification.kind,
            studioId: notification.studio_id,
            notificationId: notification.id,
          },
        });

        if (result.ok) {
          console.info("[notifications] studio_push_sent", {
            studio_id: notification.studio_id,
            notification_id: notification.id,
            recipient,
            result,
          });
          await insertNotificationLog(sb, {
            studioId: notification.studio_id,
            channel: "push_studio",
            kind: notification.kind,
            recipient,
            status: "sent",
            payload: {
              studio_notification_id: notification.id,
              subscription_id: subscription.id,
              endpoint,
              event: "studio_notification_push",
            },
          });
          dispatchedKeys.add(deliveryKey);
          return { status: "sent" as const };
        } else {
          console.error("[notifications] studio_push_failed", {
            studio_id: notification.studio_id,
            notification_id: notification.id,
            recipient,
            reason: webPushFailureReason(result),
            result,
          });
          await insertNotificationLog(sb, {
            studioId: notification.studio_id,
            channel: "push_studio",
            kind: notification.kind,
            recipient,
            status: "failed",
            error: webPushFailureReason(result),
            payload: {
              studio_notification_id: notification.id,
              subscription_id: subscription.id,
              endpoint,
              event: "studio_notification_push",
            },
          });
          if ("status" in result && (result.status === 400 || result.status === 404 || result.status === 410)) {
            await (sb as any)
              .from("push_subscriptions")
              .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq("id", subscription.id);
          }
          return { status: "failed" as const };
        }
      } catch {
        console.error("[notifications] studio_push_exception", {
          studio_id: notification.studio_id,
          notification_id: notification.id,
          recipient,
        });
        await insertNotificationLog(sb, {
          studioId: notification.studio_id,
          channel: "push_studio",
          kind: notification.kind,
          recipient,
          status: "failed",
          error: "send_exception",
          payload: {
            studio_notification_id: notification.id,
            subscription_id: subscription.id,
            endpoint,
            event: "studio_notification_push",
          },
        });
        return { status: "failed" as const };
      }
      }),
    );
    sent += deliveryResults.filter((result) => result.status === "sent").length;
    failed += deliveryResults.filter((result) => result.status === "failed").length;
  }

  return { sent, failed, skipped };
}

async function loadStudioPushTargets(
  sb: any,
  notification: StudioNotificationRow,
  dispatchedKeys: Set<string>,
) {
  const { data: studioSubscriptions, error: studioSubscriptionError } = await (sb as any)
    .from("push_subscriptions")
    .select("id,user_id,studio_id,audience,endpoint,p256dh,auth,updated_at")
    .eq("studio_id", notification.studio_id)
    .in("audience", ["studio", "both"])
    .is("revoked_at", null)
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (studioSubscriptionError) throw new Error(studioSubscriptionError.message);

  const candidates = (studioSubscriptions ?? []) as PushSubscriptionRow[];
  const byEndpoint = new Map<string, PushSubscriptionRow>();
  const targetCountByUser = new Map<string, number>();

  for (const subscription of candidates) {
    if (!subscription.user_id || !subscription.endpoint) continue;
    if (dispatchedKeys.has(studioPushDeliveryKey(notification.id, maskEndpoint(subscription.endpoint)))) continue;
    const currentUserTargets = targetCountByUser.get(subscription.user_id) ?? 0;
    if (currentUserTargets >= 12) continue;

    const isStudioAudience =
      subscription.studio_id === notification.studio_id &&
      (subscription.audience === "studio" || subscription.audience === "both");
    if (!isStudioAudience) continue;

    const current = byEndpoint.get(subscription.endpoint);
    if (!current || subscriptionTargetRank(subscription, notification.studio_id) > subscriptionTargetRank(current, notification.studio_id)) {
      byEndpoint.set(subscription.endpoint, subscription);
      targetCountByUser.set(subscription.user_id, currentUserTargets + 1);
    }
  }

  console.info("[notifications] studio_push_targets_resolved", {
    studio_id: notification.studio_id,
    notification_id: notification.id,
    studio_subscription_count: (studioSubscriptions ?? []).length,
    target_count: byEndpoint.size,
  });

  return Array.from(byEndpoint.values());
}

async function validateStudioNotificationScope(sb: any, notification: StudioNotificationRow) {
  const payloadStudioId = readPayloadString(notification.payload, "studio_id");
  if (payloadStudioId && payloadStudioId !== notification.studio_id) {
    return { ok: false as const, reason: "payload_studio_mismatch" };
  }

  const appointmentId = readPayloadString(notification.payload, "appointment_id");
  if (appointmentId) {
    const { data, error } = await sb
      .from("appointments")
      .select("id,studio_id")
      .eq("id", appointmentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.id) return { ok: false as const, reason: "appointment_missing" };
    if (data.studio_id !== notification.studio_id) {
      return { ok: false as const, reason: "appointment_studio_mismatch" };
    }
  }

  const bookingRequestId = readPayloadString(notification.payload, "booking_request_id");
  if (bookingRequestId) {
    const { data, error } = await sb
      .from("booking_payment_requests")
      .select("id,studio_id,appointment_id")
      .eq("id", bookingRequestId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.id) return { ok: false as const, reason: "booking_request_missing" };
    if (data.studio_id !== notification.studio_id) {
      return { ok: false as const, reason: "booking_request_studio_mismatch" };
    }
    if (appointmentId && data.appointment_id && data.appointment_id !== appointmentId) {
      return { ok: false as const, reason: "booking_request_appointment_mismatch" };
    }
  }

  return { ok: true as const };
}

function studioPushDeliveryKey(notificationId: string, endpoint: string) {
  return `${notificationId}:endpoint:${endpoint}`;
}

function studioPushNoTargetKey(notificationId: string, studioId: string) {
  return `${notificationId}:studio:${studioId}`;
}

function subscriptionTargetRank(subscription: PushSubscriptionRow, studioId: string) {
  if (subscription.studio_id === studioId && subscription.audience === "both") return 4;
  if (subscription.studio_id === studioId && subscription.audience === "studio") return 3;
  if (subscription.studio_id === studioId) return 2;
  return 1;
}

async function loadRecentAppointmentForDispatch(sb: any, studioId: string, appointmentId: string) {
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

async function cleanupExpiredPushSubscriptions(sb: any, studioId?: string) {
  const now = Date.now();
  let query = (sb as any)
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .is("revoked_at", null)
    .not("expiration_time", "is", null)
    .lt("expiration_time", now);

  if (studioId) query = query.eq("studio_id", studioId);

  const { error } = await query;
  if (error) console.warn("push_subscription_expiry_cleanup_failed", error.message);
}

async function cleanupExcessStudioPushSubscriptions(sb: any, studioId?: string) {
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
  for (const row of (data ?? []) as Array<{ id: string; user_id: string; studio_id: string | null }>) {
    if (!row.id || !row.user_id || !row.studio_id) continue;
    const key = `${row.studio_id}:${row.user_id}`;
    const count = keepCountByKey.get(key) ?? 0;
    if (count >= 12) {
      revokeIds.push(row.id);
      continue;
    }
    keepCountByKey.set(key, count + 1);
  }

  if (revokeIds.length === 0) return;
  const { error: updateError } = await (sb as any)
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in("id", revokeIds);
  if (updateError) console.warn("push_subscription_excess_cleanup_update_failed", updateError.message);
}

async function assertCanAccessStudio(sb: any, userId: string, studioId: string) {
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

async function insertNotificationLog(
  sb: any,
  row: {
    studioId: string;
    channel: string;
    kind: string;
    recipient: string;
    status: string;
    payload?: Record<string, unknown>;
    error?: string;
  },
) {
  await (sb as any).from("notifications_log").insert({
    studio_id: row.studioId,
    channel: row.channel,
    kind: row.kind,
    recipient: row.recipient,
    payload: row.payload ?? {},
    status: row.status,
    error: row.error ?? null,
  });
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

function studioNotificationTitle(kind: string) {
  if (kind === "new_appointment") return "Nova marcação recebida";
  if (kind === "payment_confirmed") return "Pagamento confirmado";
  if (kind === "payment_failed") return "Falha no pagamento";
  if (kind === "refund_request") return "Pedido de reembolso recebido";
  if (kind === "withdrawal_requested") return "Pedido financeiro recebido";
  return "Notificação do painel";
}

function studioNotificationBody(kind: string) {
  if (kind === "new_appointment") return "Tem uma nova marcação para acompanhar no painel.";
  if (kind === "payment_confirmed") return "Um pagamento foi confirmado.";
  if (kind === "payment_failed") return "Um pagamento precisa de atenção.";
  if (kind === "refund_request") return "Existe um pedido de reembolso para analisar.";
  if (kind === "withdrawal_requested") return "Existe uma nova atualização financeira para analisar.";
  return "Tem uma nova ação importante no painel.";
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
  if (kind === "new_appointment") return "Nova marca\u00e7\u00e3o recebida";
  if (kind === "payment_confirmed") return "Pagamento confirmado";
  if (kind === "payment_failed") return "Falha no pagamento";
  if (kind === "refund_request") return "Pedido de reembolso recebido";
  if (kind === "withdrawal_requested") return "Pedido financeiro recebido";
  return "Notifica\u00e7\u00e3o do painel";
}

function studioPushFallbackBody(kind: string) {
  if (kind === "new_appointment") return "Tem uma nova marca\u00e7\u00e3o para acompanhar no painel.";
  if (kind === "payment_confirmed") return "Um pagamento foi confirmado.";
  if (kind === "payment_failed") return "Um pagamento precisa de aten\u00e7\u00e3o.";
  if (kind === "refund_request") return "Existe um pedido de reembolso para analisar.";
  if (kind === "withdrawal_requested") return "Existe uma nova atualiza\u00e7\u00e3o financeira para analisar.";
  return "Tem uma nova a\u00e7\u00e3o importante no painel.";
}

function formatPushBody(title: string, body: string) {
  return [title, body].map((item) => item.trim()).filter(Boolean).join("\n");
}

function maskEndpoint(endpoint: string) {
  return endpoint.length <= 22 ? endpoint : `${endpoint.slice(0, 16)}...${endpoint.slice(-6)}`;
}
