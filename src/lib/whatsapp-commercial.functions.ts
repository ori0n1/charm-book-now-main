import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccessWithOptions } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

const studioSchema = z.object({ studioId: z.string().uuid() });

const platformSettingsSchema = z.object({
  globalEnabled: z.boolean(),
  trialEnabled: z.boolean(),
  trialDurationDays: z.number().int().min(1).max(365),
  trialMessageLimit: z.number().int().min(0).max(1_000_000),
  alertThresholds: z.array(z.number().int().min(1).max(100)).min(1).max(10),
  postTrialMode: z.enum(["inactive", "manual_addon"]),
  billingMode: z.enum(["disabled", "manual", "automatic"]),
  providerCostPerMessageCents: z.number().int().min(0).nullable(),
  commercialPriceCents: z.number().int().min(0).nullable(),
  commercialIncludedMessages: z.number().int().min(0).nullable(),
  commercialExcessMessageCents: z.number().int().min(0).nullable(),
  currency: z.string().trim().length(3),
  providerContractVerified: z.boolean(),
});

const entitlementSchema = z.object({
  studioId: z.string().uuid(),
  status: z.enum(["trial", "active", "inactive", "paused", "legacy"]),
  trialMessageLimitOverride: z.number().int().min(0).nullable(),
  addonEndsAt: z.string().datetime().nullable(),
  pausedReason: z.string().trim().max(240).nullable(),
});

function admin(): any {
  return getAdminClient();
}

async function assertSaasOwner(sb: any, userId: string) {
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "saas_owner")
    .limit(1);
  if (error) throw new Error(`whatsapp_admin_access_lookup_failed:${error.message}`);
  if (!data?.length) throw new Response("forbidden", { status: 403 });
}

export type WhatsAppCommercialStatus = {
  status: "trial" | "active" | "inactive" | "paused" | "legacy";
  available: boolean;
  autoSendEnabled: boolean;
  trialEndsAt: string | null;
  daysRemaining: number | null;
  used: number;
  reserved: number;
  limit: number | null;
  remaining: number | null;
  usagePercent: number | null;
  pauseReason: string | null;
  billingAvailable: boolean;
  billingMode: "disabled" | "manual" | "automatic";
  commercialPriceCents: number | null;
  currency: string;
  alerts: Array<{ thresholdPercent: number; createdAt: string }>;
};

export const getWhatsAppCommercialStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => studioSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertStudioAccessWithOptions(sb, (context as any).userId, data.studioId, {
      allowExpiredTrial: true,
      entitlement: "whatsapp",
    });
    return loadStudioCommercialStatus(sb, data.studioId);
  });

export const getWhatsAppAdminDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const userId = (context as any).userId as string;
    const sb = admin();
    let stage = "authorization";
    try {
      await assertSaasOwner(sb, userId);
      stage = "overview_query";
      const { data, error } = await sb.rpc("get_whatsapp_admin_overview");
      if (error) throw error;
      if (!data?.settings || !data?.summary || !Array.isArray(data?.studios)) {
        throw new Error("whatsapp_admin_overview_invalid_response");
      }

      const response = {
        ...data,
        settings: normalizeSettings(data.settings),
        requestId,
        generatedAt: new Date().toISOString(),
      };
      console.info("[whatsapp-admin] overview_loaded", {
        request_id: requestId,
        user_id: userId,
        studios: data.studios.length,
        duration_ms: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      const code = classifyWhatsAppAdminError(error);
      console.error("[whatsapp-admin] overview_failed", {
        request_id: requestId,
        user_id: userId,
        stage,
        error_code: code,
        database_code: typeof (error as any)?.code === "string" ? (error as any).code : undefined,
        reason: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startedAt,
      });
      throw new Error(`whatsapp_admin_overview_failed:${code}:${requestId}`);
    }
  });

function classifyWhatsAppAdminError(error: unknown) {
  const databaseCode = String((error as any)?.code ?? "");
  const message = error instanceof Error ? error.message : String(error);
  if (databaseCode === "42501" || message.includes("forbidden")) return "permission_denied";
  if (databaseCode === "42P01") return "table_missing";
  if (databaseCode === "42703") return "column_missing";
  if (databaseCode === "42883" || databaseCode === "PGRST202") return "rpc_missing";
  if (databaseCode.startsWith("PGRST")) return "query_failed";
  if (message.includes("invalid_response")) return "invalid_response";
  return "internal_error";
}

export const saveWhatsAppPlatformSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => platformSettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId as string;
    await assertSaasOwner(sb, userId);

    const thresholds = [...new Set(data.alertThresholds)].sort((a, b) => a - b);
    if (
      data.billingMode === "automatic" &&
      (!data.providerContractVerified ||
        data.providerCostPerMessageCents == null ||
        data.commercialPriceCents == null)
    ) {
      throw new Error("automatic_billing_requires_verified_provider_cost_and_commercial_price");
    }

    const { data: previous, error: previousError } = await sb
      .from("whatsapp_platform_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (previousError) throw new Error(previousError.message);

    const next = {
      global_enabled: data.globalEnabled,
      trial_enabled: data.trialEnabled,
      trial_duration_days: data.trialDurationDays,
      trial_message_limit: data.trialMessageLimit,
      alert_thresholds: thresholds,
      post_trial_mode: data.postTrialMode,
      billing_mode: data.billingMode,
      provider_cost_per_message_cents: data.providerCostPerMessageCents,
      commercial_price_cents: data.commercialPriceCents,
      commercial_included_messages: data.commercialIncludedMessages,
      commercial_excess_message_cents: data.commercialExcessMessageCents,
      currency: data.currency.toLowerCase(),
      provider_contract_verified_at: data.providerContractVerified
        ? new Date().toISOString()
        : null,
      updated_by: userId,
    };
    const { data: saved, error } = await sb
      .from("whatsapp_platform_settings")
      .update(next)
      .eq("id", 1)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await sb.from("whatsapp_admin_audit_logs").insert({
      actor_user_id: userId,
      action: "platform_settings_updated",
      before_state: previous,
      after_state: saved,
    });
    return normalizeSettings(saved);
  });

export const saveWhatsAppStudioEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => entitlementSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    const userId = (context as any).userId as string;
    await assertSaasOwner(sb, userId);
    const { data: previous } = await sb
      .from("whatsapp_studio_entitlements")
      .select("*")
      .eq("studio_id", data.studioId)
      .maybeSingle();
    const payload = {
      studio_id: data.studioId,
      status: data.status,
      trial_message_limit_override: data.trialMessageLimitOverride,
      addon_started_at:
        data.status === "active"
          ? (previous?.addon_started_at ?? new Date().toISOString())
          : previous?.addon_started_at,
      addon_ends_at: data.addonEndsAt,
      paused_reason: data.status === "paused" ? data.pausedReason || "paused_by_admin" : null,
    };
    const { data: saved, error } = await sb
      .from("whatsapp_studio_entitlements")
      .upsert(payload, { onConflict: "studio_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await sb.from("whatsapp_admin_audit_logs").insert({
      studio_id: data.studioId,
      actor_user_id: userId,
      action: "studio_entitlement_updated",
      before_state: previous,
      after_state: saved,
    });
    return saved;
  });

async function loadStudioCommercialStatus(
  sb: any,
  studioId: string,
  providedSettings?: any,
): Promise<WhatsAppCommercialStatus> {
  const [
    { data: settings, error: settingsError },
    { data: studio, error: studioError },
    usage,
    alerts,
  ] = await Promise.all([
    providedSettings
      ? Promise.resolve({ data: providedSettings, error: null })
      : sb.from("whatsapp_platform_settings").select("*").eq("id", 1).single(),
    sb
      .from("studios")
      .select(
        "id,trial_ends_at,whatsapp_auto_send_enabled,whatsapp_studio_entitlements(status,trial_started_at,trial_ends_at,trial_message_limit_override,addon_ends_at,paused_reason)",
      )
      .eq("id", studioId)
      .single(),
    sb
      .from("whatsapp_usage_ledger")
      .select("state,created_at")
      .eq("studio_id", studioId)
      .in("state", ["reserved", "submitted", "counted"]),
    sb
      .from("whatsapp_usage_alerts")
      .select("threshold_percent,created_at")
      .eq("studio_id", studioId)
      .order("threshold_percent"),
  ]);
  if (settingsError) throw new Error(settingsError.message);
  if (studioError) throw new Error(studioError.message);
  if (usage.error) throw new Error(usage.error.message);
  if (alerts.error) throw new Error(alerts.error.message);

  const entitlement = Array.isArray(studio.whatsapp_studio_entitlements)
    ? studio.whatsapp_studio_entitlements[0]
    : studio.whatsapp_studio_entitlements;
  const status = (entitlement?.status ?? "inactive") as WhatsAppCommercialStatus["status"];
  const trialStart = entitlement?.trial_started_at;
  const trialEnd = entitlement?.trial_ends_at ?? studio.trial_ends_at;
  const scopedUsage = (usage.data ?? []).filter(
    (row: any) =>
      status !== "trial" ||
      ((!trialStart || row.created_at >= trialStart) && (!trialEnd || row.created_at < trialEnd)),
  );
  const used = scopedUsage.filter((row: any) =>
    ["submitted", "counted"].includes(row.state),
  ).length;
  const reserved = scopedUsage.filter((row: any) => row.state === "reserved").length;
  const limit =
    status === "trial"
      ? Number(entitlement?.trial_message_limit_override ?? settings.trial_message_limit)
      : null;
  const available = Boolean(
    settings.global_enabled &&
    (status === "legacy" ||
      (status === "active" &&
        (!entitlement?.addon_ends_at || entitlement.addon_ends_at > new Date().toISOString())) ||
      (status === "trial" &&
        settings.trial_enabled &&
        trialEnd &&
        trialEnd > new Date().toISOString() &&
        used + reserved < (limit ?? 0))),
  );
  const daysRemaining =
    status === "trial" && trialEnd
      ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86_400_000))
      : null;
  return {
    status,
    available,
    autoSendEnabled: Boolean(studio.whatsapp_auto_send_enabled),
    trialEndsAt: trialEnd ?? null,
    daysRemaining,
    used,
    reserved,
    limit,
    remaining: limit == null ? null : Math.max(0, limit - used - reserved),
    usagePercent:
      limit == null
        ? null
        : limit === 0
          ? 100
          : Math.min(100, Math.round(((used + reserved) / limit) * 100)),
    pauseReason: entitlement?.paused_reason ?? null,
    billingAvailable:
      settings.billing_mode !== "disabled" && settings.commercial_price_cents != null,
    billingMode: settings.billing_mode,
    commercialPriceCents: settings.commercial_price_cents,
    currency: settings.currency,
    alerts: (alerts.data ?? []).map((row: any) => ({
      thresholdPercent: row.threshold_percent,
      createdAt: row.created_at,
    })),
  };
}

function normalizeSettings(row: any) {
  return {
    globalEnabled: Boolean(row.global_enabled),
    trialEnabled: Boolean(row.trial_enabled),
    trialDurationDays: Number(row.trial_duration_days),
    trialMessageLimit: Number(row.trial_message_limit),
    alertThresholds: (row.alert_thresholds ?? []).map(Number),
    postTrialMode: row.post_trial_mode,
    billingMode: row.billing_mode,
    providerCostPerMessageCents: row.provider_cost_per_message_cents,
    commercialPriceCents: row.commercial_price_cents,
    commercialIncludedMessages: row.commercial_included_messages,
    commercialExcessMessageCents: row.commercial_excess_message_cents,
    currency: row.currency,
    providerContractVerified: Boolean(row.provider_contract_verified_at),
    updatedAt: row.updated_at,
  };
}
