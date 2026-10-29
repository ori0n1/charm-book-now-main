import { getRequest } from "@tanstack/react-start/server";
import { getAdminClient } from "@/lib/supabase-admin.server";
import type { PlanFeature } from "@/lib/plan-entitlements";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type StudioAccessOptions = {
  /** @deprecated Free is a valid access state; retained for rolling compatibility. */
  allowExpiredTrial?: boolean;
  requirePremium?: boolean;
  entitlement?: PlanFeature;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function forbidden(message = "forbidden"): never {
  throw new Response(message, { status: 403 });
}

export async function assertStudioAccess(
  sb: SupabaseLike,
  userId: string,
  studioId: string,
  options: StudioAccessOptions = {},
) {
  await assertStudioAccessWithOptions(sb, userId, studioId, options);
}

export async function assertStudioOwnerAccess(
  sb: SupabaseLike,
  userId: string,
  studioId: string,
  options: StudioAccessOptions = {},
) {
  if (!userId || !studioId) forbidden();

  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .in("role", ["studio_owner", "saas_owner"])
    .limit(1)
    .maybeSingle();

  if (error || !data?.role) forbidden("studio_owner_required");
  if (options.requirePremium) await assertStudioPremiumAccess(sb, studioId);
  if (options.entitlement) await assertStudioEntitlement(sb, studioId, options.entitlement);
}

export async function assertStudioFinancialReadAccess(
  sb: SupabaseLike,
  userId: string,
  studioId: string,
  options: StudioAccessOptions = {},
) {
  if (!userId || !studioId) forbidden();
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .in("role", ["studio_owner", "saas_owner", "manager"])
    .limit(1)
    .maybeSingle();
  if (error || !data?.role) forbidden("studio_financial_read_required");
  if (options.entitlement) await assertStudioEntitlement(sb, studioId, options.entitlement);
}

export async function assertStudioPremiumAccess(sb: SupabaseLike, studioId: string) {
  await assertStudioEntitlement(sb, studioId, "whatsapp", "premium_required");
}

export async function assertStudioEntitlement(
  sb: SupabaseLike,
  studioId: string,
  entitlement: PlanFeature,
  errorCode = `plan_feature_required:${entitlement}`,
) {
  if (!studioId) forbidden(errorCode);
  const { data, error } = await sb.rpc("studio_has_entitlement", {
    _studio_id: studioId,
    _feature: entitlement,
  });
  if (error || data !== true) forbidden(errorCode);
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
  const { data: canUseStudio, error: accessError } = await sb.rpc("can_use_studio", {
    _user_id: userId,
    _studio_id: studioId,
  });
  if (accessError || canUseStudio !== true) forbidden();
  if (options.requirePremium) await assertStudioPremiumAccess(sb, studioId);
  if (options.entitlement) await assertStudioEntitlement(sb, studioId, options.entitlement);
}

/** Agenda-only access for an active desk professional, without widening can_use_studio. */
export async function assertAgendaStudioAccess(
  sb: SupabaseLike,
  userId: string,
  studioId: string,
  options: StudioAccessOptions = {},
) {
  if (!userId || !studioId) forbidden();
  const { data: canUseStudio, error: accessError } = await sb.rpc("can_use_studio", {
    _user_id: userId,
    _studio_id: studioId,
  });
  if (accessError) forbidden();
  if (canUseStudio !== true) {
    const [membership, staff, studio] = await Promise.all([
      sb.from("user_roles").select("user_id")
        .eq("user_id", userId).eq("studio_id", studioId).eq("role", "desk_staff")
        .limit(1).maybeSingle(),
      sb.from("staff").select("id")
        .eq("user_id", userId).eq("studio_id", studioId).eq("is_active", true)
        .limit(1).maybeSingle(),
      sb.from("studios").select("id")
        .eq("id", studioId).eq("is_active", true).maybeSingle(),
    ]);
    if (membership.error || staff.error || studio.error ||
      !membership.data?.user_id || !staff.data?.id || !studio.data?.id) forbidden();
  }
  if (options.requirePremium) await assertStudioPremiumAccess(sb, studioId);
  if (options.entitlement) await assertStudioEntitlement(sb, studioId, options.entitlement);
}

export async function assertAppointmentAccess(
  sb: SupabaseLike,
  userId: string,
  appointmentId: string,
  options: StudioAccessOptions = {},
) {
  const { data, error } = await sb
    .from("appointments")
    .select("studio_id,staff_id")
    .eq("id", appointmentId)
    .maybeSingle();

  if (error || !data?.studio_id) forbidden();
  await assertStudioAccessWithOptions(sb, userId, data.studio_id as string, options);

  const { data: roles, error: rolesError } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", data.studio_id);
  if (rolesError || !roles?.length) forbidden();
  if (roles.some((row: { role?: string }) => ["saas_owner", "studio_owner", "manager"].includes(String(row.role)))) {
    return;
  }
  if (!roles.some((row: { role?: string }) => row.role === "staff")) forbidden();

  const { data: staff, error: staffError } = await sb
    .from("staff")
    .select("id")
    .eq("studio_id", data.studio_id)
    .eq("user_id", userId)
    .eq("id", data.staff_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (staffError || !staff?.id) forbidden();
}

/** Agenda actions are shared by every authenticated member of the appointment's studio. */
export async function assertAgendaAppointmentAccess(
  sb: SupabaseLike,
  userId: string,
  appointmentId: string,
  options: StudioAccessOptions = {},
) {
  const { data, error } = await sb.from("appointments")
    .select("studio_id").eq("id", appointmentId).maybeSingle();
  if (error || !data?.studio_id) forbidden();
  await assertAgendaStudioAccess(sb, userId, data.studio_id as string, options);
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
  try {
    const { data, error } = await (getAdminClient() as any)
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
