import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

type SupabaseLike = {
  from: (table: string) => any;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type StudioAccessOptions = {
  requirePremium?: boolean;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
let rateLimitAdmin: ReturnType<typeof createClient> | null = null;

function forbidden(message = "forbidden"): never {
  throw new Response(message, { status: 403 });
}

export async function assertStudioAccess(sb: SupabaseLike, userId: string, studioId: string) {
  await assertStudioAccessWithOptions(sb, userId, studioId, {});
}

export async function assertStudioPremiumAccess(sb: SupabaseLike, studioId: string) {
  if (!studioId) forbidden("premium_required");

  const now = Date.now();
  const { data: studio, error: studioError } = await sb
    .from("studios")
    .select("subscription_status, subscription_current_period_end, trial_ends_at, premium_access_until, is_active")
    .eq("id", studioId)
    .maybeSingle();

  if (studioError || !studio?.is_active) forbidden("premium_required");

  const subscriptionStatus = String(studio.subscription_status || "");
  const subscriptionCurrentPeriodEnd = studio.subscription_current_period_end
    ? new Date(studio.subscription_current_period_end).getTime()
    : 0;
  const trialEndsAt = studio.trial_ends_at ? new Date(studio.trial_ends_at).getTime() : 0;
  const premiumAccessUntil = studio.premium_access_until
    ? new Date(studio.premium_access_until).getTime()
    : 0;

  if (
    (subscriptionStatus === "active" && (subscriptionCurrentPeriodEnd > now || premiumAccessUntil > now)) ||
    (subscriptionStatus === "trialing" && trialEndsAt > now) ||
    premiumAccessUntil > now
  ) {
    return;
  }

  const { data: subscription, error: subscriptionError } = await sb
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("studio_id", studioId)
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) forbidden("premium_required");

  const currentPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : 0;

  if (
    subscription &&
    ["active", "trialing"].includes(String(subscription.status)) &&
    currentPeriodEnd > now
  ) {
    return;
  }

  forbidden("premium_required");
}

export async function assertStudioAccessWithOptions(
  sb: SupabaseLike,
  userId: string,
  studioId: string,
  options: StudioAccessOptions = {},
) {
  if (!userId || !studioId) forbidden();

  const { data, error } = await sb
    .from("user_roles")
    .select("studio_id")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .limit(1)
    .maybeSingle();

  if (error || !data?.studio_id) forbidden();
  if (options.requirePremium) await assertStudioPremiumAccess(sb, studioId);
}

export async function assertAppointmentAccess(
  sb: SupabaseLike,
  userId: string,
  appointmentId: string,
  options: StudioAccessOptions = {},
) {
  const { data, error } = await sb
    .from("appointments")
    .select("studio_id")
    .eq("id", appointmentId)
    .maybeSingle();

  if (error || !data?.studio_id) forbidden();
  await assertStudioAccessWithOptions(sb, userId, data.studio_id as string, options);
}

export function getRequestFingerprint() {
  const request = getRequest();
  const forwarded = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    request?.headers.get("cf-connecting-ip") ||
    forwarded ||
    request?.headers.get("x-real-ip") ||
    "unknown-ip";
  const ua = request?.headers.get("user-agent") || "unknown-ua";
  return `${ip}:${ua.slice(0, 80)}`;
}

export async function rateLimitOrThrow({ key, limit, windowMs }: RateLimitOptions) {
  const durableResult = await consumeDurableRateLimit({ key, limit, windowMs });
  if (durableResult === "allowed") return;
  if (durableResult && durableResult.retryAfter > 0) {
    throw new Response("rate_limit_exceeded", {
      status: 429,
      headers: { "Retry-After": String(durableResult.retryAfter) },
    });
  }

  const now = Date.now();
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(bucketKey);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    throw new Response("rate_limit_exceeded", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000)) },
    });
  }
}

async function consumeDurableRateLimit({ key, limit, windowMs }: RateLimitOptions) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  try {
    if (!rateLimitAdmin) {
      rateLimitAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });
    }

    const { data, error } = await (rateLimitAdmin as any)
      .rpc("consume_rate_limit", {
        p_key: key,
        p_limit: limit,
        p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
      })
      .maybeSingle();

    if (error || !data) return null;
    if (data.allowed) return "allowed";
    return { retryAfter: Number(data.retry_after || Math.ceil(windowMs / 1000)) };
  } catch (error) {
    console.error("durable rate limit fallback", error);
    return null;
  }
}
