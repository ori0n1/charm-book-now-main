import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { sendWebPush } from "@/lib/web-push.server";
import { BELLZA_APP_ICON_192, BELLZA_NOTIFICATION_BADGE } from "@/lib/brand-assets";

const StaffStatusInput = z.object({
  staffId: z.string().uuid(),
  status: z.enum(["online", "busy", "absent"]),
});

export const updateStaffPresenceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StaffStatusInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("Unauthorized", { status: 401 });

    const sb = getAdminClient();
    const { data: staff, error: staffError } = await sb
      .from("staff")
      .select("id,name,studio_id,current_status,updated_at,studios:studio_id(name,slug,logo_url,updated_at)")
      .eq("id", data.staffId)
      .maybeSingle();
    if (staffError) throw new Error(staffError.message);
    if (!staff?.id || !staff.studio_id) throw new Response("staff_not_found", { status: 404 });

    await assertCanManageStudio(sb, userId, staff.studio_id);

    const previousStatus = normalizePresenceStatus(staff.current_status);
    const updatedAt = staff.updated_at ? new Date(staff.updated_at).getTime() : 0;
    const changedRecently = Number.isFinite(updatedAt) && Date.now() - updatedAt < 20 * 60 * 1000;

    const { error } = await sb
      .from("staff")
      .update({ current_status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.staffId);
    if (error) throw new Error(error.message);

    let notification: { sent: number; failed: number; skipped?: string } | null = null;
    if (data.status === "online" && previousStatus !== "online" && !changedRecently) {
      notification = await notifyFollowersThatStaffIsOnline(sb, {
        studioId: staff.studio_id,
        staffName: staff.name ?? "Profissional",
        studio: Array.isArray((staff as any).studios) ? (staff as any).studios[0] : (staff as any).studios,
      });
    } else if (data.status === "online" && previousStatus !== "online" && changedRecently) {
      notification = { sent: 0, failed: 0, skipped: "cooldown" };
    }

    return { ok: true, notification };
  });

async function assertCanManageStudio(sb: any, userId: string, studioId: string) {
  await assertStudioAccess(sb, userId, studioId, { entitlement: "notifications" });
}

function normalizePresenceStatus(status?: string | null) {
  if (status === "busy") return "busy";
  if (status === "absent") return "absent";
  return "online";
}

async function notifyFollowersThatStaffIsOnline(
  sb: any,
  {
    studioId,
    staffName,
    studio,
  }: {
    studioId: string;
    staffName: string;
    studio?: { name?: string | null; slug?: string | null; logo_url?: string | null; updated_at?: string | null } | null;
  },
) {
  const { data: follows, error: followsError } = await sb
    .from("studio_follows")
    .select("user_id")
    .eq("studio_id", studioId)
    .limit(1000);
  if (followsError) throw new Error(followsError.message);

  const followerIds = (follows ?? []).map((row: any) => row.user_id).filter(Boolean);
  const { data: allSubscriptions, error } = await (sb as any)
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .eq("studio_id", studioId)
    .in("audience", ["client", "both"])
    .is("revoked_at", null)
    .limit(1000);
  if (error) throw new Error(error.message);
  const subscribedUserIds = (allSubscriptions ?? []).map((row: any) => row.user_id).filter(Boolean);
  const targetUserIds = Array.from(new Set([...followerIds, ...subscribedUserIds]));
  if (targetUserIds.length === 0) return { sent: 0, failed: 0, skipped: "no_client_targets" };

  const subscriptions = (allSubscriptions ?? []).filter((row: any) => targetUserIds.includes(row.user_id));
  if (!subscriptions?.length) return { sent: 0, failed: 0, skipped: "no_subscriptions" };

  let sent = 0;
  let failed = 0;
  const payload = {
    title: "Agenda disponível",
    body: `${staffName} tem horários disponíveis para reserva. Consulte a agenda se desejar.`,
    url: studio?.slug ? `/s/${studio.slug}` : "/",
    icon: studio?.logo_url
      ? withPushAssetVersion(studio.logo_url, studio.updated_at)
      : BELLZA_APP_ICON_192,
    badge: BELLZA_NOTIFICATION_BADGE,
    tag: `staff-online-${studioId}`,
    data: { studioId, kind: "staff_online" },
  };

  await insertClientCenterNotifications(sb, {
    studioId,
    userIds: targetUserIds,
    kind: "staff_online",
    title: payload.title,
    body: payload.body,
    payload: {
      studio_id: studioId,
      staff_name: staffName,
      studio_slug: studio?.slug ?? null,
      event: "staff_status_online",
    },
  });

  for (const subscription of subscriptions) {
    try {
      const result = await sendWebPush(subscription, payload);
      if (result.ok) {
        sent += 1;
        await insertNotificationLog(sb, {
          studioId,
          channel: "push_client",
          kind: "staff_online",
          recipient: `user:${subscription.user_id}`,
          status: "sent",
          payload: { endpoint: maskEndpoint(subscription.endpoint), event: "staff_status_online" },
        });
      } else {
        failed += 1;
        await insertNotificationLog(sb, {
          studioId,
          channel: "push_client",
          kind: "staff_online",
          recipient: `user:${subscription.user_id}`,
          status: "failed",
          error: "status" in result ? `web_push_${result.status}` : result.skipped,
          payload: { endpoint: maskEndpoint(subscription.endpoint), event: "staff_status_online" },
        });
        if ("status" in result && (result.status === 404 || result.status === 410)) {
          await (sb as any)
            .from("push_subscriptions")
            .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", subscription.id);
        }
      }
    } catch {
      failed += 1;
      await insertNotificationLog(sb, {
        studioId,
        channel: "push_client",
        kind: "staff_online",
        recipient: `user:${subscription.user_id}`,
        status: "failed",
        error: "send_exception",
        payload: { endpoint: maskEndpoint(subscription.endpoint), event: "staff_status_online" },
      });
    }
  }

  return { sent, failed };
}

async function insertClientCenterNotifications(
  sb: any,
  {
    studioId,
    userIds,
    kind,
    title,
    body,
    payload,
  }: {
    studioId: string;
    userIds: string[];
    kind: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  },
) {
  const rows = userIds.map((userId) => ({
    studio_id: studioId,
    channel: "client_center",
    kind,
    recipient: `user:${userId}`,
    status: "unread",
    payload: { ...payload, title, body, recipient_user_id: userId },
  }));
  if (rows.length === 0) return;
  await (sb as any).from("notifications_log").insert(rows);
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

function maskEndpoint(endpoint: string) {
  return endpoint.length <= 22 ? endpoint : `${endpoint.slice(0, 16)}...${endpoint.slice(-6)}`;
}

function withPushAssetVersion(url: string, version?: string | null) {
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}
