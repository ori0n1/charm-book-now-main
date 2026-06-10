import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeBusinessSegment, type BusinessSegment } from "@/lib/segments";

export type CurrentStudio = {
  id: string;
  name: string;
  slug: string;
  role: AppRole;
  business_segment: BusinessSegment;
  commission_percent: number;
  deposit_percent: number;
  deposit_recipient: string;
  deposit_professional_percent: number;
  payment_policy: string;
  min_booking_notice_min: number;
};

export type AppRole = "saas_owner" | "studio_owner" | "manager" | "staff" | "desk_staff";

async function fetchStudios(): Promise<CurrentStudio[]> {
  const full = await supabase
    .from("user_roles")
    .select(
      "studio_id,role, studios:studio_id(id,name,slug,business_segment,commission_percent,deposit_percent,deposit_recipient,deposit_professional_percent,payment_policy,min_booking_notice_min)",
    );
  if (!full.error) return normalizeStudios(full.data);

  const legacy = await supabase
    .from("user_roles")
    .select(
      "studio_id,role, studios:studio_id(id,name,slug,commission_percent,deposit_percent,payment_policy)",
    );
  if (legacy.error) throw legacy.error;
  return normalizeStudios(legacy.data);
}

function normalizeStudios(data: unknown): CurrentStudio[] {
  return (Array.isArray(data) ? data : [])
    .map((r: unknown) => {
      const row = r as { role?: AppRole | null; studios: Partial<CurrentStudio> | null };
      const studio = row.studios;
      if (!studio?.id || !studio.name || !studio.slug) return null;
      return {
        id: studio.id,
        name: studio.name,
        slug: studio.slug,
        role: row.role ?? "studio_owner",
        business_segment: normalizeBusinessSegment(studio.business_segment),
        commission_percent: studio.commission_percent ?? 50,
        deposit_percent: studio.deposit_percent ?? 25,
        deposit_recipient: studio.deposit_recipient ?? "studio",
        deposit_professional_percent: studio.deposit_professional_percent ?? 0,
        payment_policy: studio.payment_policy ?? "pay_in_studio",
        min_booking_notice_min: studio.min_booking_notice_min ?? 30,
      };
    })
    .filter((s: CurrentStudio | null): s is CurrentStudio => !!s)
    .sort((a, b) => roleRank(a.role) - roleRank(b.role));
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
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
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
