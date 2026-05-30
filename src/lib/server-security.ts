import { getRequest } from "@tanstack/react-start/server";

type SupabaseLike = {
  from: (table: string) => any;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function forbidden(message = "forbidden"): never {
  throw new Response(message, { status: 403 });
}

export async function assertStudioAccess(sb: SupabaseLike, userId: string, studioId: string) {
  if (!userId || !studioId) forbidden();

  const { data, error } = await sb
    .from("user_roles")
    .select("studio_id")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .limit(1)
    .maybeSingle();

  if (error || !data?.studio_id) forbidden();
}

export async function assertAppointmentAccess(
  sb: SupabaseLike,
  userId: string,
  appointmentId: string,
) {
  const { data, error } = await sb
    .from("appointments")
    .select("studio_id")
    .eq("id", appointmentId)
    .maybeSingle();

  if (error || !data?.studio_id) forbidden();
  await assertStudioAccess(sb, userId, data.studio_id as string);
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

