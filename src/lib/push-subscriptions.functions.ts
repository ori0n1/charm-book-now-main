import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { sendWebPush } from "@/lib/web-push.server";
import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";

const PushSubscriptionInput = z.object({
  audience: z.enum(["client", "studio"]),
  studioId: z.string().uuid().optional(),
  subscription: z.object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
});

const TestPushInput = z.object({
  audience: z.enum(["client", "studio"]),
  studioId: z.string().uuid().optional(),
});

const StudioPushHealthInput = z.object({
  studioId: z.string().uuid(),
});

const RevokeCurrentDeviceInput = z.object({
  endpoint: z.string().url(),
});

const MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_STUDIO_USER = 12;

export const getStudioPushHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioPushHealthInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("Unauthorized", { status: 401 });

    const sb = getAdminClient();
    const studioId = await resolvePrimaryStudioId(sb, userId, data.studioId);
    if (!studioId) throw new Response("forbidden", { status: 403 });

    const now = Date.now();
    const { data: subscriptions, error } = await (sb as any)
      .from("push_subscriptions")
      .select("id,expiration_time,last_seen_at,updated_at")
      .eq("user_id", userId)
      .eq("studio_id", studioId)
      .in("audience", ["studio", "both"])
      .is("revoked_at", null)
      .order("updated_at", { ascending: false })
      .limit(MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_STUDIO_USER);
    if (error) throw new Error(error.message);

    const active = (subscriptions ?? []).filter(
      (row: { expiration_time: number | null }) =>
        row.expiration_time === null || row.expiration_time > now,
    );

    return {
      ok: true,
      activeDevices: active.length,
      lastSeenAt: active[0]?.last_seen_at ?? null,
    };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PushSubscriptionInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    const claims = ((context as any).claims ?? {}) as Record<string, unknown>;
    if (!userId) throw new Response("Unauthorized", { status: 401 });

    const sb = getAdminClient();
    const studioId =
      data.audience === "client"
        ? data.studioId
        : await resolvePrimaryStudioId(sb, userId, data.studioId);

    if (!studioId) throw new Error("push_studio_missing");

    const clientId =
      data.audience === "client" ? await resolveClientId(sb, userId, studioId, claims) : null;

    const { data: existing, error: existingError } = await (sb as any)
      .from("push_subscriptions")
      .select("id,audience,client_id,studio_id,revoked_at")
      .eq("endpoint", data.subscription.endpoint)
      .eq("studio_id", studioId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const { data: endpointOwners, error: endpointOwnersError } = await (sb as any)
      .from("push_subscriptions")
      .select("id,user_id")
      .eq("endpoint", data.subscription.endpoint)
      .is("revoked_at", null);
    if (endpointOwnersError) throw new Error(endpointOwnersError.message);

    const belongsToAnotherAccount = (endpointOwners ?? []).some(
      (row: { user_id: string }) => row.user_id !== userId,
    );
    if (existing?.revoked_at || belongsToAnotherAccount) {
      await insertNotificationLog(sb, {
        studioId,
        channel: data.audience === "client" ? "push_client" : "push_studio",
        kind: "push_subscription",
        recipient: `user:${userId}`,
        status: "renewal_required",
        error: existing?.revoked_at ? "revoked_endpoint_reused" : "endpoint_account_changed",
        payload: { event: "push_subscription_renewal_required" },
      });
      return {
        ok: false,
        requiresRenewal: true,
        reason: existing?.revoked_at ? "revoked_endpoint_reused" : "endpoint_account_changed",
      };
    }

    await revokeEndpointSubscriptionsFromOtherAccounts(sb, {
      userId,
      endpoint: data.subscription.endpoint,
    });

    const now = new Date().toISOString();
    const audience = mergePushAudience(existing?.audience, data.audience);
    const request = getRequest();
    const payload = {
      user_id: userId,
      studio_id: studioId,
      client_id: clientId ?? existing?.client_id ?? null,
      audience,
      endpoint: data.subscription.endpoint,
      p256dh: data.subscription.keys.p256dh,
      auth: data.subscription.keys.auth,
      expiration_time: data.subscription.expirationTime ?? null,
      user_agent: request?.headers.get("user-agent")?.slice(0, 500) || null,
      revoked_at: null,
      revocation_reason: null,
      last_seen_at: now,
      updated_at: now,
    };

    const { error } = await (sb as any)
      .from("push_subscriptions")
      .upsert(payload, { onConflict: "endpoint,studio_id" });
    if (error) {
      await insertNotificationLog(sb, {
        studioId,
        channel: data.audience === "client" ? "push_client" : "push_studio",
        kind: "push_subscription",
        recipient: `user:${userId}`,
        status: "failed",
        error: `subscription_store_${error.code ?? "database_error"}`,
        payload: {
          event: "push_subscription_store_failed",
          audience,
          endpoint: maskEndpoint(data.subscription.endpoint),
          browser: request?.headers.get("user-agent")?.slice(0, 250) || null,
        },
      });
      throw new Error(error.message);
    }

    await insertNotificationLog(sb, {
      studioId,
      channel: data.audience === "client" ? "push_client" : "push_studio",
      kind: "push_subscription",
      recipient: `user:${userId}`,
      status: "active",
      payload: {
        event: existing?.id
          ? "push_subscription_refreshed"
          : "push_subscription_registered",
        audience,
        endpoint: maskEndpoint(data.subscription.endpoint),
        browser: request?.headers.get("user-agent")?.slice(0, 250) || null,
      },
    });

    if (clientId) {
      await (sb as any)
        .from("clients")
        .update({
          notification_consent_status: "granted",
          notification_consent_at: now,
          updated_at: now,
        })
        .eq("id", clientId);
    }

    await pruneOldPushSubscriptions(sb, userId, studioId);

    if (data.audience === "studio") {
      await dispatchPendingStudioPushNotifications({ studioId }).catch((dispatchError) => {
        console.error("[push] pending_studio_delivery_after_subscription_failed", {
          studio_id: studioId,
          user_id: userId,
          reason: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
        });
      });
    }

    return { ok: true, requiresRenewal: false };
  });

export const revokeCurrentDevicePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RevokeCurrentDeviceInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("Unauthorized", { status: 401 });

    const sb = getAdminClient();
    const now = new Date().toISOString();
    const { data: rows, error } = await (sb as any)
      .from("push_subscriptions")
      .update({
        revoked_at: now,
        revocation_reason: "user_logout",
        updated_at: now,
      })
      .eq("user_id", userId)
      .eq("endpoint", data.endpoint)
      .is("revoked_at", null)
      .select("studio_id,audience");
    if (error) throw new Error(error.message);

    for (const row of rows ?? []) {
      if (!row.studio_id) continue;
      await insertNotificationLog(sb, {
        studioId: row.studio_id,
        channel: row.audience === "client" ? "push_client" : "push_studio",
        kind: "push_subscription",
        recipient: `user:${userId}`,
        status: "revoked",
        error: "user_logout",
        payload: { event: "push_subscription_revoked_on_logout" },
      });
    }

    return { ok: true, revoked: rows?.length ?? 0 };
  });

export const sendTestPushNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => TestPushInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("Unauthorized", { status: 401 });

    const sb = getAdminClient();
    const studioId =
      data.audience === "client"
        ? data.studioId
        : await resolvePrimaryStudioId(sb, userId, data.studioId);
    if (!studioId) throw new Error("push_studio_missing");

    const audiences = data.audience === "client" ? ["client", "both"] : ["studio", "both"];
    const { data: primarySubscriptions, error } = await (sb as any)
      .from("push_subscriptions")
      .select("id,user_id,studio_id,audience,endpoint,p256dh,auth")
      .eq("user_id", userId)
      .eq("studio_id", studioId)
      .in("audience", audiences)
      .is("revoked_at", null)
      .order("updated_at", { ascending: false })
      .limit(3);
    if (error) throw new Error(error.message);

    const subscriptions = ((primarySubscriptions ?? []) as Array<{
      id: string;
      user_id: string;
      studio_id: string | null;
      audience: string | null;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>).filter(
      (subscription) =>
        subscription.studio_id === studioId &&
        (subscription.audience === data.audience || subscription.audience === "both"),
    );

    if (!subscriptions?.length) {
      await insertNotificationLog(sb, {
        studioId,
        channel: data.audience === "client" ? "push_client" : "push_studio",
        kind: "push_test",
        recipient: `user:${userId}`,
        status: "failed",
        error: "no_active_subscription",
        payload: { event: "push_test" },
      });
      return { ok: false, sent: 0, failed: 0, reason: "no_active_subscription" };
    }

    let sent = 0;
    let failed = 0;
    for (const subscription of subscriptions) {
      const result = await sendWebPush(subscription, {
        title: "Notificações Bellza ativas",
        body:
          data.audience === "client"
            ? "Este PWA já pode receber avisos das suas reservas."
            : "Este PWA já pode receber avisos do painel.",
        url: data.audience === "client" ? "/" : "/admin",
        icon: "/pwa-icon.svg",
        badge: "/pwa-icon.svg",
        tag: `bellza-push-test-${data.audience}-${studioId}`,
        data: { kind: "push_test", studioId, audience: data.audience },
      });

      if (result.ok) {
        sent += 1;
        await insertNotificationLog(sb, {
          studioId,
          channel: data.audience === "client" ? "push_client" : "push_studio",
          kind: "push_test",
          recipient: `user:${userId}`,
          status: "sent",
          payload: { event: "push_test", endpoint: maskEndpoint(subscription.endpoint) },
        });
      } else {
        failed += 1;
        await insertNotificationLog(sb, {
          studioId,
          channel: data.audience === "client" ? "push_client" : "push_studio",
          kind: "push_test",
          recipient: `user:${userId}`,
          status: "failed",
          error: webPushFailureReason(result),
          payload: { event: "push_test", endpoint: maskEndpoint(subscription.endpoint) },
        });
        if ("status" in result && (result.status === 404 || result.status === 410)) {
          await (sb as any)
            .from("push_subscriptions")
            .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", subscription.id);
        }
      }
    }

    return { ok: sent > 0, sent, failed };
  });

async function resolvePrimaryStudioId(sb: any, userId: string, preferredStudioId?: string) {
  let query = sb
    .from("user_roles")
    .select("studio_id")
    .eq("user_id", userId)
    .not("studio_id", "is", null)
    .limit(1);

  if (preferredStudioId) query = query.eq("studio_id", preferredStudioId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data?.studio_id ?? null;
}


async function resolveClientId(
  sb: any,
  userId: string,
  studioId: string,
  claims: Record<string, unknown>,
) {
  const email = String(claims.email ?? "").trim().toLowerCase();
  const query = sb
    .from("clients")
    .select("id")
    .eq("studio_id", studioId)
    .eq("auth_user_id", userId)
    .limit(1);

  let { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id) return data.id as string;

  if (!email) return null;
  ({ data, error } = await sb
    .from("clients")
    .select("id")
    .eq("studio_id", studioId)
    .ilike("email", email)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle());
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}

async function revokeEndpointSubscriptionsFromOtherAccounts(
  sb: any,
  input: {
    userId: string;
    endpoint: string;
  },
) {
  const now = new Date().toISOString();
  const { error } = await (sb as any)
    .from("push_subscriptions")
    .update({
      revoked_at: now,
      revocation_reason: "endpoint_account_changed",
      updated_at: now,
    })
    .eq("endpoint", input.endpoint)
    .neq("user_id", input.userId)
    .is("revoked_at", null);

  if (error) {
    console.error("[push] cross_account_subscription_revoke_failed", {
      user_id: input.userId,
      reason: error.message,
    });
    throw new Error(error.message);
  }
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

function mergePushAudience(existingAudience: string | null | undefined, requestedAudience: "client" | "studio") {
  if (!existingAudience || existingAudience === requestedAudience) return requestedAudience;
  if (existingAudience === "both") return "both";
  return "both";
}

async function pruneOldPushSubscriptions(sb: any, userId: string, studioId: string) {
  const { data, error } = await (sb as any)
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .is("revoked_at", null)
    .order("updated_at", { ascending: false })
    .range(MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_STUDIO_USER, 1000);
  if (error) {
    console.warn("[push] prune_old_subscriptions_failed", {
      studio_id: studioId,
      user_id: userId,
      reason: error.message,
    });
    return;
  }

  const ids = (data ?? []).map((row: { id: string }) => row.id).filter(Boolean);
  if (ids.length === 0) return;

  const { error: updateError } = await (sb as any)
    .from("push_subscriptions")
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: "device_limit_exceeded",
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (updateError) {
    console.warn("[push] prune_old_subscriptions_update_failed", {
      studio_id: studioId,
      user_id: userId,
      reason: updateError.message,
    });
  }
}

function maskEndpoint(endpoint: string) {
  return endpoint.length <= 22 ? endpoint : `${endpoint.slice(0, 16)}...${endpoint.slice(-6)}`;
}
