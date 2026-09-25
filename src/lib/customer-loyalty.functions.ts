import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess } from "@/lib/server-security";
import { resolveStripeAppBaseUrl } from "@/lib/stripe.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

const StudioInput = z.object({ studioId: z.string().uuid() });

const SettingsInput = StudioInput.extend({
  enabled: z.boolean(),
  bookingStampsEnabled: z.boolean(),
  stampsPerCompletedBooking: z.number().int().min(0).max(100),
  referralStampsEnabled: z.boolean(),
  stampsPerCompletedReferral: z.number().int().min(0).max(100),
  stampsRequiredForReward: z.number().int().min(1).max(1000),
  rewardType: z.enum(["percent", "fixed"]),
  rewardValue: z.number().min(0).max(10000),
  levels: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(40),
        threshold: z.number().int().min(0).max(10000),
      }),
    )
    .min(1)
    .max(6),
});

export type CustomerLoyaltySettings = {
  enabled: boolean;
  bookingStampsEnabled: boolean;
  stampsPerCompletedBooking: number;
  referralStampsEnabled: boolean;
  stampsPerCompletedReferral: number;
  stampsRequiredForReward: number;
  rewardType: "percent" | "fixed";
  rewardValue: number;
  levels: Array<{ name: string; threshold: number }>;
};

export type CustomerLoyaltyAdminSummary = {
  settings: CustomerLoyaltySettings;
  totalClientsWithStamps: number;
  totalCompletedReferrals: number;
  totalAvailableRewards: number;
  topClients: Array<{
    id: string;
    name: string;
    stamps: number;
    completedReferrals: number;
    availableRewards: number;
  }>;
};

export async function loadCustomerLoyaltySummaryForClient(options: {
  studioId: string;
  studioSlug: string;
  clientId: string | null;
}) {
  if (!options.clientId) return null;
  const sb = getAdminClient();
  const settings = normalizeSettings(await ensureSettings(options.studioId));
  if (!isCustomerLoyaltyEnabled(settings)) return null;

  const { data: code, error: codeError } = await (sb as any).rpc("get_or_create_customer_referral_code", {
    p_studio_id: options.studioId,
    p_client_id: options.clientId,
  });
  if (codeError) {
    console.error("[customer-loyalty] referral_code_failed", {
      studio_id: options.studioId,
      client_id: options.clientId,
      error: codeError.message,
    });
    return null;
  }

  const [{ data: stamps }, { data: referrals }, { data: rewards }] = await Promise.all([
    (sb as any)
      .from("customer_loyalty_stamp_entries")
      .select("stamps")
      .eq("studio_id", options.studioId)
      .eq("client_id", options.clientId),
    (sb as any)
      .from("customer_referrals")
      .select("id,status")
      .eq("studio_id", options.studioId)
      .eq("referrer_client_id", options.clientId),
    (sb as any)
      .from("customer_loyalty_rewards")
      .select("id,status,reward_type,reward_value,stamps_required,created_at")
      .eq("studio_id", options.studioId)
      .eq("client_id", options.clientId)
      .order("created_at", { ascending: false }),
  ]);

  const totalStamps = (stamps ?? []).reduce((sum: number, row: any) => sum + Number(row.stamps ?? 0), 0);
  const completedReferrals = (referrals ?? []).filter((row: any) => row.status === "completed").length;
  const availableRewards = (rewards ?? []).filter((row: any) => row.status === "available");
  const nextRewardAt = settings.stampsRequiredForReward;
  const progressStamps = nextRewardAt > 0 ? totalStamps % nextRewardAt : 0;

  return {
    settings,
    referralCode: String(code ?? ""),
    referralUrl: `${resolveStripeAppBaseUrl()}/s/${options.studioSlug}?ref=${encodeURIComponent(String(code ?? ""))}`,
    totalStamps,
    progressStamps,
    nextRewardAt,
    completedReferrals,
    availableRewards: availableRewards.map((row: any) => ({
      id: row.id as string,
      type: row.reward_type as "percent" | "fixed",
      value: Number(row.reward_value ?? 0),
      stampsRequired: Number(row.stamps_required ?? settings.stampsRequiredForReward),
      createdAt: row.created_at as string,
    })),
    levelName: resolveLevelName(settings.levels, totalStamps),
  };
}

export const getCustomerLoyaltyAdminSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertStudioAccess(sb, (context as any).userId, data.studioId, {
      entitlement: "loyalty",
    });
    return loadCustomerLoyaltyAdminSummary(data.studioId);
  });

export const updateCustomerLoyaltySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertStudioAccess(sb, (context as any).userId, data.studioId, {
      entitlement: "loyalty",
    });
    const payload = {
      studio_id: data.studioId,
      enabled: data.enabled,
      booking_stamps_enabled: data.bookingStampsEnabled,
      stamps_per_completed_booking: data.stampsPerCompletedBooking,
      referral_stamps_enabled: data.referralStampsEnabled,
      stamps_per_completed_referral: data.stampsPerCompletedReferral,
      stamps_required_for_reward: data.stampsRequiredForReward,
      reward_type: data.rewardType,
      reward_value: data.rewardValue,
      levels: data.levels,
      updated_at: new Date().toISOString(),
    };
    const { error } = await (sb as any)
      .from("customer_loyalty_settings")
      .upsert(payload, { onConflict: "studio_id" });
    if (error) throw new Error(error.message);
    console.info("[customer-loyalty] settings_updated", { studio_id: data.studioId });
    return loadCustomerLoyaltyAdminSummary(data.studioId);
  });

async function loadCustomerLoyaltyAdminSummary(studioId: string): Promise<CustomerLoyaltyAdminSummary> {
  const sb = getAdminClient();
  const settings = normalizeSettings(await ensureSettings(studioId));
  const [{ data: stampRows }, { data: referrals }, { data: rewards }] = await Promise.all([
    (sb as any)
      .from("customer_loyalty_stamp_entries")
      .select("client_id,stamps,clients(id,name)")
      .eq("studio_id", studioId),
    (sb as any)
      .from("customer_referrals")
      .select("referrer_client_id,status")
      .eq("studio_id", studioId),
    (sb as any)
      .from("customer_loyalty_rewards")
      .select("client_id,status")
      .eq("studio_id", studioId),
  ]);

  const byClient = new Map<string, { id: string; name: string; stamps: number; completedReferrals: number; availableRewards: number }>();
  for (const row of stampRows ?? []) {
    const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    const clientId = String(row.client_id ?? client?.id ?? "");
    if (!clientId) continue;
    const item = byClient.get(clientId) ?? {
      id: clientId,
      name: String(client?.name ?? "Cliente"),
      stamps: 0,
      completedReferrals: 0,
      availableRewards: 0,
    };
    item.stamps += Number(row.stamps ?? 0);
    byClient.set(clientId, item);
  }
  for (const row of referrals ?? []) {
    if (row.status !== "completed") continue;
    const clientId = String(row.referrer_client_id ?? "");
    if (!clientId) continue;
    const item = byClient.get(clientId) ?? {
      id: clientId,
      name: "Cliente",
      stamps: 0,
      completedReferrals: 0,
      availableRewards: 0,
    };
    item.completedReferrals += 1;
    byClient.set(clientId, item);
  }
  for (const row of rewards ?? []) {
    if (row.status !== "available") continue;
    const clientId = String(row.client_id ?? "");
    if (!clientId) continue;
    const item = byClient.get(clientId) ?? {
      id: clientId,
      name: "Cliente",
      stamps: 0,
      completedReferrals: 0,
      availableRewards: 0,
    };
    item.availableRewards += 1;
    byClient.set(clientId, item);
  }

  const topClients = Array.from(byClient.values())
    .sort((a, b) => b.stamps - a.stamps || b.completedReferrals - a.completedReferrals)
    .slice(0, 8);

  return {
    settings,
    totalClientsWithStamps: Array.from(byClient.values()).filter((client) => client.stamps > 0).length,
    totalCompletedReferrals: (referrals ?? []).filter((row: any) => row.status === "completed").length,
    totalAvailableRewards: (rewards ?? []).filter((row: any) => row.status === "available").length,
    topClients,
  };
}

async function ensureSettings(studioId: string) {
  const sb = getAdminClient();
  const { data, error } = await (sb as any).rpc("ensure_customer_loyalty_settings", {
    p_studio_id: studioId,
  });
  if (error) throw new Error(error.message);
  return data;
}

function normalizeSettings(row: any): CustomerLoyaltySettings {
  return {
    enabled: row?.enabled ?? false,
    bookingStampsEnabled: row?.booking_stamps_enabled ?? true,
    stampsPerCompletedBooking: Number(row?.stamps_per_completed_booking ?? 1),
    referralStampsEnabled: row?.referral_stamps_enabled ?? true,
    stampsPerCompletedReferral: Number(row?.stamps_per_completed_referral ?? 1),
    stampsRequiredForReward: Number(row?.stamps_required_for_reward ?? 10),
    rewardType: row?.reward_type === "fixed" ? "fixed" : "percent",
    rewardValue: Number(row?.reward_value ?? 10),
    levels: normalizeLevels(row?.levels),
  };
}

export function isCustomerLoyaltyEnabled(settings: Pick<CustomerLoyaltySettings, "enabled"> | null | undefined) {
  return settings?.enabled === true;
}

function normalizeLevels(value: unknown): Array<{ name: string; threshold: number }> {
  const fallback = [
    { name: "Cliente", threshold: 0 },
    { name: "Cliente fiel", threshold: 10 },
    { name: "Embaixadora", threshold: 25 },
  ];
  if (!Array.isArray(value)) return fallback;
  const levels = value
    .map((item: any) => ({
      name: String(item?.name ?? "").trim(),
      threshold: Number(item?.threshold ?? 0),
    }))
    .filter((item) => item.name.length >= 2 && Number.isFinite(item.threshold))
    .sort((a, b) => a.threshold - b.threshold);
  return levels.length ? levels : fallback;
}

function resolveLevelName(levels: Array<{ name: string; threshold: number }>, stamps: number) {
  return [...levels].sort((a, b) => a.threshold - b.threshold).reduce((current, level) => {
    return stamps >= level.threshold ? level.name : current;
  }, levels[0]?.name ?? "Cliente");
}
