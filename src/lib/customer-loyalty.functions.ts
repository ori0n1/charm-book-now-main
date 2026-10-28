import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess } from "@/lib/server-security";
import { resolveStripeAppBaseUrl } from "@/lib/stripe.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

const StudioInput = z.object({ studioId: z.string().uuid() });
const RewardRuleInput = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(2).max(60).optional(),
  stampsRequired: z.number().int().min(1).max(1000),
  type: z.enum(["percent", "fixed"]),
  value: z.number().min(0).max(10000),
  enabled: z.boolean(),
  startedAt: z.string().datetime().nullable(),
});
export type CustomerLoyaltyRewardRule = z.infer<typeof RewardRuleInput>;

const SettingsInput = StudioInput.extend({
  enabled: z.boolean(),
  bookingStampsEnabled: z.boolean(),
  stampsPerCompletedBooking: z.number().int().min(0).max(100),
  referralStampsEnabled: z.boolean(),
  stampsPerCompletedReferral: z.number().int().min(0).max(100),
  stampsRequiredForReward: z.number().int().min(1).max(1000),
  rewardType: z.enum(["percent", "fixed"]),
  rewardValue: z.number().min(0).max(10000),
  rewardRules: z.array(RewardRuleInput).max(12),
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
  rewardRules: CustomerLoyaltyRewardRule[];
  levels: Array<{ name: string; threshold: number }>;
};

export type CustomerLoyaltyAdminSummary = {
  settings: CustomerLoyaltySettings;
  totalClientsWithStamps: number;
  totalCompletedReferrals: number;
  totalAvailableRewards: number;
  recentReferrals: Array<{ id: string; referrerName: string; referredName: string; status: string; createdAt: string; rejectionReason: string | null }>;
  topClients: Array<{
    id: string;
    name: string;
    stamps: number;
    completedReferrals: number;
    availableRewards: number;
  }>;
};

async function assertLoyaltyManager(sb: ReturnType<typeof getAdminClient>, userId: string, studioId: string) {
  await assertStudioAccess(sb, userId, studioId, { entitlement: "loyalty" });
  const { data, error } = await sb.from("user_roles").select("role")
    .eq("user_id", userId).eq("studio_id", studioId)
    .in("role", ["saas_owner", "studio_owner", "manager"]).limit(1).maybeSingle();
  if (error || !data?.role) throw new Response("loyalty_management_forbidden", { status: 403 });
}

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
      .select("stamps,created_at")
      .eq("studio_id", options.studioId)
      .eq("client_id", options.clientId),
    (sb as any)
      .from("customer_referrals")
      .select("id,status")
      .eq("studio_id", options.studioId)
      .eq("referrer_client_id", options.clientId),
    (sb as any)
      .from("customer_loyalty_rewards")
      .select("id,status,reward_type,reward_value,stamps_required,created_at,used_at,redemption_code")
      .eq("studio_id", options.studioId)
      .eq("client_id", options.clientId)
      .order("created_at", { ascending: false }),
  ]);

  const totalStamps = (stamps ?? []).reduce((sum: number, row: any) => sum + Number(row.stamps ?? 0), 0);
  const completedReferrals = (referrals ?? []).filter((row: any) => row.status === "completed").length;
  const availableRewards = (rewards ?? []).filter((row: any) => row.status === "available");
  const activeRules = settings.rewardRules.filter((rule) => rule.enabled).sort((a, b) => a.stampsRequired - b.stampsRequired);
  const cycleLength = activeRules.length ? Math.max(...activeRules.map((rule) => rule.stampsRequired)) : 0;
  const progressStamps = cycleLength ? totalStamps % cycleLength : 0;
  const nextRewardAt = activeRules.find((rule) => rule.stampsRequired > progressStamps)?.stampsRequired ?? cycleLength;
  const earnedCount = (rewards ?? []).filter((row: any) => row.status !== "cancelled").length;
  const programs = activeRules.map((rule, index) => {
    const eligibleStamps = (stamps ?? []).reduce((sum: number, row: any) =>
      sum + (!rule.startedAt || new Date(row.created_at).getTime() > new Date(rule.startedAt).getTime()
        ? Number(row.stamps ?? 0) : 0), 0);
    const inCycle = cycleLength ? eligibleStamps % cycleLength : eligibleStamps;
    const earned = Math.min(rule.stampsRequired, inCycle);
    return {
      id: rule.id,
      name: rule.name || `Programa ${index + 1}`,
      stampsRequired: rule.stampsRequired,
      stampsEarned: earned,
      stampsRemaining: Math.max(0, rule.stampsRequired - earned),
      type: rule.type,
      value: rule.value,
    };
  });

  return {
    settings,
    referralCode: String(code ?? ""),
    referralUrl: `${resolveStripeAppBaseUrl()}/s/${options.studioSlug}?ref=${encodeURIComponent(String(code ?? ""))}`,
    totalStamps,
    progressStamps,
    nextRewardAt,
    programs,
    completedReferrals,
    availableRewards: availableRewards.map((row: any) => ({
      id: row.id as string,
      type: row.reward_type as "percent" | "fixed",
      value: Number(row.reward_value ?? 0),
      stampsRequired: Number(row.stamps_required ?? settings.stampsRequiredForReward),
      createdAt: row.created_at as string,
      code: String(row.redemption_code ?? ""),
    })),
    usedRewards: (rewards ?? []).filter((row: any) => row.status === "used").map((row: any) => ({
      id: String(row.id), usedAt: String(row.used_at ?? ""),
      type: row.reward_type as "percent" | "fixed", value: Number(row.reward_value ?? 0),
    })),
    expiredRewards: (rewards ?? []).filter((row: any) => row.status === "expired").map((row: any) => ({
      id: String(row.id),
      type: row.reward_type as "percent" | "fixed", value: Number(row.reward_value ?? 0),
    })),
    vipBadge: earnedCount >= 5 ? "Cliente Elite" : earnedCount >= 3 ? "Cliente VIP" : earnedCount >= 1 ? "Cliente Fiel" : null,
    levelName: resolveLevelName(settings.levels, totalStamps),
  };
}

export const getCustomerLoyaltyAdminSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertLoyaltyManager(sb, (context as any).userId, data.studioId);
    return loadCustomerLoyaltyAdminSummary(data.studioId);
  });

export const updateCustomerLoyaltySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertLoyaltyManager(sb, (context as any).userId, data.studioId);
    const previous = normalizeSettings(await ensureSettings(data.studioId));
    const ids = new Set<string>();
    const rewardRules = data.rewardRules.map((rule) => {
      if (rule.type === "percent" && rule.value > 100) throw new Error("invalid_reward_percentage");
      if (ids.has(rule.id)) throw new Error("duplicate_reward_rule");
      ids.add(rule.id);
      const old = previous.rewardRules.find((item) => item.id === rule.id);
      if (old && old.stampsRequired === rule.stampsRequired && old.type === rule.type && old.value === rule.value
        && !(old.enabled === false && rule.enabled === true)) {
        return { ...rule, startedAt: old.startedAt };
      }
      return { ...rule, id: old ? crypto.randomUUID() : rule.id, startedAt: new Date().toISOString() };
    });
    if (new Set(rewardRules.filter((rule) => rule.enabled).map((rule) => rule.stampsRequired)).size !== rewardRules.filter((rule) => rule.enabled).length) {
      throw new Error("duplicate_reward_threshold");
    }
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
      reward_rules: rewardRules,
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

const RedemptionInput = StudioInput.extend({ code: z.string().trim().min(8).max(80).transform((value) => value.replace(/[\s-]/g, "").toUpperCase()) });

export const lookupCustomerLoyaltyReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RedemptionInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertLoyaltyManager(sb, (context as any).userId, data.studioId);
    const { data: reward, error } = await (sb as any).from("customer_loyalty_rewards")
      .select("id,status,reward_type,reward_value,clients(name)")
      .eq("studio_id", data.studioId).eq("redemption_code", data.code.toUpperCase()).maybeSingle();
    if (error) throw new Error(error.message);
    if (!reward) return null;
    return { id: reward.id, status: reward.status, type: reward.reward_type, value: Number(reward.reward_value),
      clientName: String((Array.isArray(reward.clients) ? reward.clients[0] : reward.clients)?.name ?? "Cliente") };
  });

export const redeemCustomerLoyaltyReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RedemptionInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertLoyaltyManager(sb, (context as any).userId, data.studioId);
    const { data: reward, error } = await (sb as any).from("customer_loyalty_rewards")
      .update({ status: "used", used_at: new Date().toISOString() })
      .eq("studio_id", data.studioId).eq("redemption_code", data.code.toUpperCase())
      .eq("status", "available").select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!reward) throw new Error("reward_not_available");
    return { id: String(reward.id), status: "used" as const };
  });

export const findCustomerLoyaltyClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.extend({ query: z.string().trim().max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertLoyaltyManager(sb, (context as any).userId, data.studioId);
    let request = (sb as any).from("clients").select("id,name")
      .eq("studio_id", data.studioId).order("name").limit(30);
    if (data.query) request = request.ilike("name", `%${data.query.replace(/[%_\\]/g, "\\$&")}%`);
    const { data: clients, error } = await request;
    if (error) throw new Error(error.message);
    const ids = (clients ?? []).map((row: any) => String(row.id));
    if (!ids.length) return [];
    const { data: entries, error: entriesError } = await (sb as any)
      .from("customer_loyalty_stamp_entries").select("client_id,stamps")
      .eq("studio_id", data.studioId).in("client_id", ids);
    if (entriesError) throw new Error(entriesError.message);
    const balances = new Map<string, number>();
    for (const entry of entries ?? []) balances.set(String(entry.client_id), (balances.get(String(entry.client_id)) ?? 0) + Number(entry.stamps ?? 0));
    return (clients ?? []).map((client: any) => ({ id: String(client.id), name: String(client.name), stamps: balances.get(String(client.id)) ?? 0 }));
  });

const StampAdjustmentInput = StudioInput.extend({
  clientId: z.string().uuid(),
  delta: z.number().int().min(-20).max(20).refine((value) => value !== 0),
  note: z.string().trim().min(5).max(300),
  actionId: z.string().uuid(),
});

export const adjustCustomerLoyaltyStamps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StampAdjustmentInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const actorId = (context as any).userId as string;
    await assertLoyaltyManager(sb, actorId, data.studioId);
    const { data: entryId, error } = await (sb as any).rpc("admin_adjust_customer_loyalty_stamps", {
      p_studio_id: data.studioId, p_client_id: data.clientId, p_delta: data.delta,
      p_note: data.note, p_actor_id: actorId, p_action_id: data.actionId,
    });
    if (error) throw new Error(error.message);
    console.info("[customer-loyalty] stamps_adjusted", { studio_id: data.studioId, client_id: data.clientId, entry_id: entryId });
    return { entryId: String(entryId) };
  });

export const decideCustomerReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.extend({ referralId: z.string().uuid(), approve: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    await assertLoyaltyManager(sb, (context as any).userId, data.studioId);
    const { data: status, error } = await (sb as any).rpc("admin_decide_customer_referral", {
      p_studio_id: data.studioId, p_referral_id: data.referralId, p_approve: data.approve,
    });
    if (error) throw new Error(error.message);
    console.info("[customer-loyalty] referral_decided", { studio_id: data.studioId, referral_id: data.referralId, status });
    return { status: String(status) };
  });

async function loadCustomerLoyaltyAdminSummary(studioId: string): Promise<CustomerLoyaltyAdminSummary> {
  const sb = getAdminClient();
  const settings = normalizeSettings(await ensureSettings(studioId));
  const [{ data: stampRows, error: stampsError }, { data: referrals, error: referralsError }, { data: rewards, error: rewardsError }, { data: recentReferrals, error: recentError }] = await Promise.all([
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
    (sb as any)
      .from("customer_referrals")
      .select("id,referrer_client_id,referred_client_id,status,created_at,rejection_reason")
      .eq("studio_id", studioId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (stampsError || referralsError || rewardsError || recentError) {
    throw new Error((stampsError ?? referralsError ?? rewardsError ?? recentError).message);
  }

  const referralClientIds = Array.from(new Set((recentReferrals ?? []).flatMap((row: any) =>
    [row.referrer_client_id, row.referred_client_id].filter(Boolean))));
  const { data: referralClients, error: referralClientsError } = referralClientIds.length
    ? await (sb as any).from("clients").select("id,name").eq("studio_id", studioId).in("id", referralClientIds)
    : { data: [], error: null };
  if (referralClientsError) throw new Error(referralClientsError.message);
  const clientNames = new Map((referralClients ?? []).map((row: any) => [String(row.id), String(row.name)]));

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
    recentReferrals: (recentReferrals ?? []).map((row: any) => ({
      id: String(row.id), referrerName: clientNames.get(String(row.referrer_client_id)) ?? "Cliente",
      referredName: clientNames.get(String(row.referred_client_id)) ?? "A aguardar reserva",
      status: String(row.status), createdAt: String(row.created_at),
      rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    })),
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
    rewardRules: normalizeRewardRules(row?.reward_rules, row),
    levels: normalizeLevels(row?.levels),
  };
}

function normalizeRewardRules(value: unknown, row: any): CustomerLoyaltyRewardRule[] {
  if (Array.isArray(value)) return value.map((rule) => RewardRuleInput.parse(rule));
  return [{ id: "legacy", stampsRequired: Number(row?.stamps_required_for_reward ?? 10),
    type: row?.reward_type === "fixed" ? "fixed" : "percent", value: Number(row?.reward_value ?? 10),
    enabled: true, startedAt: null }];
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
