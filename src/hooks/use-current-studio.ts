import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSettledSession } from "@/lib/auth-landing";
import { normalizeBusinessSegment, type BusinessSegment } from "@/lib/segments";
import { normalizeStudioTimeZone } from "@/lib/studio-time";
import { normalizePlanTier, type PlanTier } from "@/lib/plan-entitlements";
import { ADMIN_REFERENCE_GC_MS, ADMIN_REFERENCE_STALE_MS } from "@/lib/admin-query-cache";

export type CurrentStudio = {
  id: string;
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

async function fetchStudios(): Promise<CurrentStudio[]> {
  let userId: string | null = null;
  if (typeof window !== "undefined") {
    const session = await getSettledSession();
    if (!session?.access_token) throw new Error("Sessão não encontrada.");
    userId = session.user.id;
  }

  const full = await supabase
    .from("user_roles")
    .select(
      "studio_id,role, studios:studio_id(id,name,owner_name,slug,business_segment,commission_percent,deposit_percent,deposit_recipient,deposit_professional_percent,payment_policy,min_booking_notice_min,staff_agenda_visibility,timezone,plan_tier)",
    );
  if (!full.error) return withStaffIdentity(normalizeStudios(full.data), userId);

  const legacy = await supabase
    .from("user_roles")
    .select(
      "studio_id,role, studios:studio_id(id,name,slug,commission_percent,deposit_percent,payment_policy)",
    );
  if (legacy.error) throw legacy.error;
  return withStaffIdentity(normalizeStudios(legacy.data), userId);
}

function normalizeStudios(data: unknown): CurrentStudio[] {
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
  userId: string | null,
): Promise<CurrentStudio[]> {
  if (!userId || studios.length === 0) return studios;
  const { data } = await supabase
    .from("staff")
    .select("id,name,studio_id,user_id")
    .eq("user_id", userId)
    .in(
      "studio_id",
      studios.map((studio) => studio.id),
    );
  const staffByStudio = new Map(
    (data ?? []).map((staff) => [
      staff.studio_id,
      { id: staff.id, name: staff.name },
    ]),
  );
  return studios.map((studio) => {
    const staff = staffByStudio.get(studio.id);
    return staff ? { ...studio, staff_id: staff.id, staff_name: staff.name } : studio;
  });
}

function roleRank(role: AppRole) {
  if (role === "saas_owner") return 0;
  if (role === "studio_owner") return 1;
  if (role === "manager") return 2;
  if (role === "staff") return 3;
  return 4;
}

export function useCurrentStudio() {
  const query = useQuery({
    queryKey: ["current-studio"],
    queryFn: fetchStudios,
    staleTime: ADMIN_REFERENCE_STALE_MS,
    gcTime: ADMIN_REFERENCE_GC_MS,
    enabled: typeof window !== "undefined",
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  return {
    studio: query.data?.[0] ?? null,
    studios: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
