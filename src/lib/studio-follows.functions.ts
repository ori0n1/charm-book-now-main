import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { sendWebPush } from "@/lib/web-push.server";

export type FollowedStudio = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  updated_at?: string | null;
  rating: number | null;
  reviews_count: number | null;
  location: string | null;
};

const StudioIdInput = z.object({ studioId: z.string().uuid() });
const FollowerNotificationInput = z.object({
  studioId: z.string().uuid(),
  kind: z.enum([
    "promotion",
    "new_service",
    "open_slot",
    "cancellation",
    "news",
    "staff_available",
    "client_at_risk",
    "personal_offer",
  ]),
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().min(8).max(220),
});

/** Toggle follow/unfollow for the authenticated user */
export const toggleStudioFollow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;

    const { data: existing } = await sb
      .from("studio_follows")
      .select("id")
      .eq("user_id", userId)
      .eq("studio_id", data.studioId)
      .maybeSingle();

    if (existing) {
      await sb.from("studio_follows").delete().eq("id", existing.id);
      return { following: false };
    }

    await sb.from("studio_follows").insert({ user_id: userId, studio_id: data.studioId });
    return { following: true };
  });

/** Get follow status of a single studio for the authenticated user */
export const getStudioFollowStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;

    const { data: row } = await sb
      .from("studio_follows")
      .select("id")
      .eq("user_id", userId)
      .eq("studio_id", data.studioId)
      .maybeSingle();

    return { following: Boolean(row) };
  });

/** Get all studios followed by the authenticated user */
export const getFollowedStudios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;

    const { data } = await sb
      .from("studio_follows")
      .select(
        "studio:studio_id(id, name, slug, logo_url, updated_at, rating, reviews_count, location)",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    const studios: FollowedStudio[] = (data ?? [])
      .map((row: any) => row.studio)
      .filter(Boolean);

    return { studios };
  });

/** Send one scoped notification to the private follower community of a studio. */
export const sendFollowerNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FollowerNotificationInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("Unauthorized", { status: 401 });

    const { data: studio, error: studioError } = await sb
      .from("studios")
      .select("id,name,slug,logo_url,updated_at")
      .eq("id", data.studioId)
      .maybeSingle();
    if (studioError) throw new Error(studioError.message);
    if (!studio?.id) throw new Response("studio_not_found", { status: 404 });

    await assertCanManageStudio(sb, userId, data.studioId);
    const cooldown = await getFollowerNotificationCooldown(sb, data.studioId, data.kind);
    if (cooldown.active) {
      return { ok: false, sent: 0, failed: 0, followers: 0, skipped: "cooldown" as const };
    }

    const { data: follows, error: followsError } = await sb
      .from("studio_follows")
      .select("user_id")
      .eq("studio_id", data.studioId)
      .limit(1500);
    if (followsError) throw new Error(followsError.message);

    const followerIds = Array.from(
      new Set((follows ?? []).map((row: any) => row.user_id).filter(Boolean)),
    );
    if (followerIds.length === 0) {
      await insertNotificationLog(sb, {
        studioId: data.studioId,
        channel: "client_center",
        kind: `follower_${data.kind}`,
        recipient: `studio:${data.studioId}`,
        status: "skipped",
        error: "no_followers",
        payload: { event: "follower_broadcast", category: data.kind, title: data.title, body: data.body },
      });
      return { ok: true, sent: 0, failed: 0, followers: 0, skipped: "no_followers" as const };
    }

    await insertClientCenterNotifications(sb, {
      studioId: data.studioId,
      userIds: followerIds,
      kind: `follower_${data.kind}`,
      title: data.title,
      body: data.body,
      payload: {
        studio_id: data.studioId,
        studio_slug: studio.slug ?? null,
        event: "follower_broadcast",
        category: data.kind,
      },
    });

    const { data: subscriptions, error: subscriptionError } = await (sb as any)
      .from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .eq("studio_id", data.studioId)
      .in("audience", ["client", "both"])
      .in("user_id", followerIds)
      .is("revoked_at", null)
      .limit(1500);
    if (subscriptionError) throw new Error(subscriptionError.message);

    let sent = 0;
    let failed = 0;
    const payload = {
      title: data.title,
      body: data.body,
      url: studio.slug ? `/s/${studio.slug}` : "/",
      icon: withPushAssetVersion(studio.logo_url || "/pwa-icon.svg", studio.updated_at),
      badge: "/pwa-icon.svg",
      tag: `follower-${data.kind}-${data.studioId}`,
      data: { studioId: data.studioId, kind: `follower_${data.kind}` },
    };

    for (const subscription of subscriptions ?? []) {
      try {
        const result = await sendWebPush(subscription, payload);
        if (result.ok) {
          sent += 1;
          await insertNotificationLog(sb, {
            studioId: data.studioId,
            channel: "push_client",
            kind: `follower_${data.kind}`,
            recipient: `user:${subscription.user_id}`,
            status: "sent",
            payload: {
              endpoint: maskEndpoint(subscription.endpoint),
              event: "follower_broadcast",
              category: data.kind,
            },
          });
        } else {
          failed += 1;
          await insertNotificationLog(sb, {
            studioId: data.studioId,
            channel: "push_client",
            kind: `follower_${data.kind}`,
            recipient: `user:${subscription.user_id}`,
            status: "failed",
            error: webPushFailureReason(result),
            payload: {
              endpoint: maskEndpoint(subscription.endpoint),
              event: "follower_broadcast",
              category: data.kind,
            },
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
          studioId: data.studioId,
          channel: "push_client",
          kind: `follower_${data.kind}`,
          recipient: `user:${subscription.user_id}`,
          status: "failed",
          error: "send_exception",
          payload: {
            endpoint: maskEndpoint(subscription.endpoint),
            event: "follower_broadcast",
            category: data.kind,
          },
        });
      }
    }

    if ((subscriptions ?? []).length === 0) {
      await insertNotificationLog(sb, {
        studioId: data.studioId,
        channel: "push_client",
        kind: `follower_${data.kind}`,
        recipient: `studio:${data.studioId}`,
        status: "skipped",
        error: "no_client_push_subscription",
        payload: { event: "follower_broadcast", category: data.kind },
      });
    }

    return { ok: true, sent, failed, followers: followerIds.length };
  });

async function assertCanManageStudio(sb: any, userId: string, studioId: string) {
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

async function getFollowerNotificationCooldown(sb: any, studioId: string, kind: string) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await (sb as any)
    .from("notifications_log")
    .select("id")
    .eq("studio_id", studioId)
    .eq("kind", `follower_${kind}`)
    .eq("channel", "push_client")
    .in("status", ["sent", "skipped"])
    .gte("created_at", cutoff)
    .limit(1);
  if (error) throw new Error(error.message);
  return { active: Boolean(data?.length) };
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
  if (rows.length > 0) await (sb as any).from("notifications_log").insert(rows);
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

function webPushFailureReason(result: Awaited<ReturnType<typeof sendWebPush>>) {
  if ("status" in result) return `web_push_${result.status}`;
  if ("skipped" in result) return result.skipped;
  return "web_push_failed";
}

function maskEndpoint(endpoint: string) {
  return endpoint.length <= 22 ? endpoint : `${endpoint.slice(0, 16)}...${endpoint.slice(-6)}`;
}

function withPushAssetVersion(url: string, version?: string | null) {
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}
