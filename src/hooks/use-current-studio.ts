import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getSettledSession } from "@/lib/auth-landing";
import { normalizeBusinessSegment, type BusinessSegment } from "@/lib/segments";
import { normalizeStudioTimeZone } from "@/lib/studio-time";
import { normalizePlanTier, type PlanTier } from "@/lib/plan-entitlements";
import { ADMIN_REFERENCE_GC_MS, ADMIN_REFERENCE_STALE_MS } from "@/lib/admin-query-cache";
import { getDeskStudioShells } from "@/lib/desk-access.functions";

export type CurrentStudio = {
  id: string;
  user_id: string;
  user_name: string | null;
  user_avatar_url: string | null;
  name: string;
  owner_name: string | null;
  slug: string;
  role: AppRole;
  staff_id: string | null;
  staff_name: string | null;
  business_segment: BusinessSegment;
  commission_percent: number;
  deposit_percent: number;
  deposit_recipient: string;
  deposit_professional_percent: number;
  payment_policy: string;
  min_booking_notice_min: number;
  staff_agenda_visibility: "private" | "team_busy" | "team_basic";
  timezone: string;
  plan_tier: PlanTier;
};

export type AppRole = "saas_owner" | "studio_owner" | "manager" | "staff" | "desk_staff";

const selectedStudioKey = (userId: string) => `bellza:selected-studio:${userId}`;

export function chooseCurrentStudio<T extends { id: string }>(
  studios: T[],
  preferredId: string | null,
): T | null {
  return studios.find((studio) => studio.id === preferredId) ?? studios[0] ?? null;
}

export function saveSelectedStudio(userId: string, studioId: string) {
  window.localStorage.setItem(selectedStudioKey(userId), studioId);
}

async function fetchStudios(
  user: User,
  loadDeskStudioShells: () => Promise<unknown>,
): Promise<CurrentStudio[]> {
  const session = await getSettledSession();
  if (!session?.access_token || session.user.id !== user.id) {
    throw new Error("Sessão não encontrada.");
  }
  const identity = getAuthIdentity(user);

  const full = await supabase
    .from("user_roles")
    .select(
      "studio_id,role, studios:studio_id(id,name,owner_name,slug,business_segment,commission_percent,deposit_percent,deposit_recipient,deposit_professional_percent,payment_policy,min_booking_notice_min,staff_agenda_visibility,timezone,plan_tier)",
    );
  if (!full.error) {
    const normalized = normalizeStudios(full.data, user.id, identity);
    const hasHiddenDeskMembership = (full.data ?? []).some(
      (row: any) => row?.role === "desk_staff" && row?.studio_id && !relationOne(row?.studios)?.id,
    );
    if (!hasHiddenDeskMembership) return withStaffIdentity(normalized, user.id);
    const deskShells = normalizeDeskStudioShells(
      await loadDeskStudioShells(),
      user.id,
      identity,
    );
    return withStaffIdentity(mergeStudios(normalized, deskShells), user.id);
  }

  const legacy = await supabase
    .from("user_roles")
    .select(
      "studio_id,role, studios:studio_id(id,name,slug,commission_percent,deposit_percent,payment_policy)",
    );
  if (legacy.error) throw legacy.error;
  return withStaffIdentity(normalizeStudios(legacy.data, user.id, identity), user.id);
}

function normalizeStudios(
  data: unknown,
  userId: string,
  identity: { name: string | null; avatarUrl: string | null },
): CurrentStudio[] {
  return (Array.isArray(data) ? data : [])
    .map((r: unknown): CurrentStudio | null => {
      const row = r as {
        role?: AppRole | null;
        studios: Partial<CurrentStudio> | Partial<CurrentStudio>[] | null;
      };
      const studio = Array.isArray(row.studios) ? row.studios[0] : row.studios;
      if (!studio?.id || !studio.name || !studio.slug) return null;
      return {
        id: studio.id,
        user_id: userId,
        user_name: identity.name,
        user_avatar_url: identity.avatarUrl,
        name: studio.name,
        owner_name: studio.owner_name ?? null,
        slug: studio.slug,
        role: row.role ?? "studio_owner",
        staff_id: null,
        staff_name: null,
        business_segment: normalizeBusinessSegment(studio.business_segment),
        commission_percent: studio.commission_percent ?? 50,
        deposit_percent: studio.deposit_percent ?? 25,
        deposit_recipient: studio.deposit_recipient ?? "studio",
        deposit_professional_percent: studio.deposit_professional_percent ?? 0,
        payment_policy: studio.payment_policy ?? "pay_in_studio",
        min_booking_notice_min: studio.min_booking_notice_min ?? 30,
        staff_agenda_visibility: studio.staff_agenda_visibility ?? "private",
        timezone: normalizeStudioTimeZone(studio.timezone),
        plan_tier: normalizePlanTier(studio.plan_tier),
      };
    })
    .filter((s: CurrentStudio | null): s is CurrentStudio => !!s)
    .sort((a, b) => roleRank(a.role) - roleRank(b.role));
}

async function withStaffIdentity(
  studios: CurrentStudio[],
  userId: string,
): Promise<CurrentStudio[]> {
  if (studios.length === 0) return studios;
  const staffStudios = studios.filter((studio) =>
    ["manager", "staff", "desk_staff"].includes(studio.role),
  );
  if (staffStudios.length === 0) return studios;
  const { data } = await supabase
    .from("staff")
    .select("id,name,photo_url,studio_id,user_id")
    .eq("user_id", userId)
    .in(
      "studio_id",
      staffStudios.map((studio) => studio.id),
    );
  const staffByStudio = new Map(
    (data ?? []).map((staff) => [
      staff.studio_id,
      { id: staff.id, name: staff.name, photoUrl: staff.photo_url },
    ]),
  );
  return studios.map((studio) => {
    const staff = staffByStudio.get(studio.id);
    return staff
      ? {
          ...studio,
          staff_id: staff.id,
          staff_name: staff.name,
          user_name: staff.name,
          user_avatar_url: staff.photoUrl ?? studio.user_avatar_url,
        }
      : studio;
  });
}

function getAuthIdentity(user: User) {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    name: firstString(metadata.staff_name, metadata.full_name, metadata.name),
    avatarUrl: firstString(metadata.avatar_url, metadata.picture),
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function roleRank(role: AppRole) {
  if (role === "saas_owner") return 0;
  if (role === "studio_owner") return 1;
  if (role === "manager") return 2;
  if (role === "staff") return 3;
  return 4;
}

export function useCurrentStudio() {
  const { user, loading: authLoading } = useAuth();
  const loadDeskStudioShells = useServerFn(getDeskStudioShells);
  const query = useQuery({
    queryKey: ["current-studio", user?.id ?? null],
    queryFn: () => fetchStudios(user!, () => loadDeskStudioShells()),
    staleTime: ADMIN_REFERENCE_STALE_MS,
    gcTime: ADMIN_REFERENCE_GC_MS,
    enabled: typeof window !== "undefined" && !authLoading && !!user,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const studios = query.data ?? [];
  let preferredId: string | null = null;
  if (typeof window !== "undefined" && user?.id) {
    try {
      preferredId = window.localStorage.getItem(selectedStudioKey(user.id));
    } catch {
      // Private browsing can disable localStorage; the first membership remains usable.
    }
  }

  return {
    studio: chooseCurrentStudio(studios, preferredId),
    studios,
    loading: authLoading || !user || query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeDeskStudioShells(
  value: unknown,
  userId: string,
  identity: { name: string | null; avatarUrl: string | null },
): CurrentStudio[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row: any): CurrentStudio | null => {
      if (!row?.id || !row?.name || !row?.slug || row?.role !== "desk_staff") return null;
      return {
        id: row.id,
        user_id: userId,
        user_name: row.staff_name ?? identity.name,
        user_avatar_url: row.staff_photo_url ?? identity.avatarUrl,
        name: row.name,
        owner_name: null,
        slug: row.slug,
        role: "desk_staff",
        staff_id: row.staff_id ?? null,
        staff_name: row.staff_name ?? null,
        business_segment: normalizeBusinessSegment(row.business_segment),
        commission_percent: 50,
        deposit_percent: 25,
        deposit_recipient: "studio",
        deposit_professional_percent: 0,
        payment_policy: row.payment_policy ?? "pay_in_studio",
        min_booking_notice_min: row.min_booking_notice_min ?? 30,
        staff_agenda_visibility: "private",
        timezone: normalizeStudioTimeZone(row.timezone),
        plan_tier: "free",
      };
    })
    .filter((studio: CurrentStudio | null): studio is CurrentStudio => studio !== null);
}

function mergeStudios(primary: CurrentStudio[], fallback: CurrentStudio[]) {
  const byId = new Map(primary.map((studio) => [studio.id, studio]));
  for (const studio of fallback) {
    if (!byId.has(studio.id)) byId.set(studio.id, studio);
  }
  return [...byId.values()].sort((a, b) => roleRank(a.role) - roleRank(b.role));
}
