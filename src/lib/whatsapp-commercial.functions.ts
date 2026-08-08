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
    });
    return loadStudioCommercialStatus(sb, data.studioId);
  });

export const getWhatsAppAdminDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = admin();
    await assertSaasOwner(sb, (context as any).userId);

    const [{ data: settings, error: settingsError }, { data: studios, error: studiosError }] =
      await Promise.all([
        sb.from("whatsapp_platform_settings").select("*").eq("id", 1).single(),
        sb
          .from("studios")
          .select(
            "id,name,subscription_status,trial_ends_at,whatsapp_auto_send_enabled,whatsapp_studio_entitlements(status,trial_started_at,trial_ends_at,trial_message_limit_override,addon_started_at,addon_ends_at,paused_reason)",
          )
          .order("name"),
      ]);
    if (settingsError) throw new Error(settingsError.message);
    if (studiosError) throw new Error(studiosError.message);

    const baseStudioRows = await Promise.all(
      (studios ?? []).map(async (studio: any) => ({
        id: studio.id,
        name: studio.name,
        subscriptionStatus: studio.subscription_status,
        ...(await loadStudioCommercialStatus(sb, studio.id, settings)),
      })),
    );

    const [{ data: ledger, error: ledgerError }, { data: messageLogs, error: logsError }] =
      await Promise.all([
        sb
          .from("whatsapp_usage_ledger")
          .select("studio_id,state,unit_cost_cents,commercial_unit_cents,created_at"),
        sb.from("whatsapp_message_logs").select("studio_id,status,reason,created_at"),
      ]);
    if (ledgerError) throw new Error(ledgerError.message);
    if (logsError) throw new Error(logsError.message);
    const submitted = (ledger ?? []).filter((row: any) =>
      ["submitted", "counted"].includes(row.state),
    );
    const studioRows = baseStudioRows.map((studio) => {
      const studioLedger = submitted.filter((row: any) => row.studio_id === studio.id);
      const studioLogs = (messageLogs ?? []).filter((row: any) => row.studio_id === studio.id);
      return {
        ...studio,
        sentMessages: studioLogs.filter((row: any) => row.status === "sent").length,
        pendingMessages: studioLogs.filter((row: any) => row.status === "pending").length,
        failedMessages: studioLogs.filter((row: any) => row.status === "failed").length,
        blockedMessages: studioLogs.filter(
          (row: any) =>
            row.status === "skipped" &&
            String(row.reason || "").startsWith("whatsapp_"),
        ).length,
        estimatedProviderCostCents: studioLedger.reduce(
          (sum: number, row: any) => sum + Number(row.unit_cost_cents ?? 0),
          0,
        ),
        estimatedRevenueCents: studioLedger.reduce(
          (sum: number, row: any) => sum + Number(row.commercial_unit_cents ?? 0),
          0,
        ),
      };
    });

    return {
      settings: normalizeSettings(settings),
      summary: {
        studiosUsing: studioRows.filter((row) => row.available && row.autoSendEnabled).length,
        trialStudios: studioRows.filter((row) => row.status === "trial").length,
        payingStudios: studioRows.filter((row) => row.status === "active").length,
        messages: submitted.length,
        failedMessages: (messageLogs ?? []).filter((row: any) => row.status === "failed").length,
        blockedMessages: (messageLogs ?? []).filter(
          (row: any) =>
            row.status === "skipped" && String(row.reason || "").startsWith("whatsapp_"),
        ).length,
        estimatedProviderCostCents: submitted.reduce(
          (sum: number, row: any) => sum + Number(row.unit_cost_cents ?? 0),
          0,
        ),
        estimatedRevenueCents: submitted.reduce(
          (sum: number, row: any) => sum + Number(row.commercial_unit_cents ?? 0),
          0,
        ),
        costConfigured: settings.provider_cost_per_message_cents != null,
      },
      studios: studioRows,
    };
  });

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
      provider_contract_verified_at: data.providerContractVerified ? new Date().toISOString() : null,
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
      addon_started_at: data.status === "active" ? previous?.addon_started_at ?? new Date().toISOString() : previous?.addon_started_at,
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
  const [{ data: settings, error: settingsError }, { data: studio, error: studioError }, usage, alerts] =
    await Promise.all([
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
    (row: any) => status !== "trial" || (!trialStart || row.created_at >= trialStart) && (!trialEnd || row.created_at < trialEnd),
  );
  const used = scopedUsage.filter((row: any) => ["submitted", "counted"].includes(row.state)).length;
  const reserved = scopedUsage.filter((row: any) => row.state === "reserved").length;
  const limit =
    status === "trial"
      ? Number(entitlement?.trial_message_limit_override ?? settings.trial_message_limit)
      : null;
  const available = Boolean(
    settings.global_enabled &&
      (status === "legacy" ||
        status === "active" && (!entitlement?.addon_ends_at || entitlement.addon_ends_at > new Date().toISOString()) ||
        status === "trial" && settings.trial_enabled && trialEnd && trialEnd > new Date().toISOString() && used + reserved < (limit ?? 0)),
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
    usagePercent: limit == null ? null : limit === 0 ? 100 : Math.min(100, Math.round(((used + reserved) / limit) * 100)),
    pauseReason: entitlement?.paused_reason ?? null,
    billingAvailable: settings.billing_mode !== "disabled" && settings.commercial_price_cents != null,
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
