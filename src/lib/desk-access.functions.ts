import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";

type DeskStudioShell = {
  id: string;
  name: string;
  slug: string;
  role: "desk_staff";
  staff_id: string;
  staff_name: string;
  staff_photo_url: string | null;
  business_segment: string | null;
  timezone: string | null;
  payment_policy: string | null;
  min_booking_notice_min: number | null;
};

export const getDeskStudioShells = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeskStudioShell[]> => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    if (!userId) throw new Response("unauthorized", { status: 401 });

    const { data: memberships, error: membershipError } = await admin
      .from("user_roles")
      .select("studio_id")
      .eq("user_id", userId)
      .eq("role", "desk_staff")
      .not("studio_id", "is", null);
    if (membershipError) throw new Error(membershipError.message);

    const studioIds = [...new Set((memberships ?? []).map((row: any) => row.studio_id).filter(Boolean))];
    if (studioIds.length === 0) return [];

    const [{ data: staffRows, error: staffError }, { data: studioRows, error: studioError }] =
      await Promise.all([
        admin
          .from("staff")
          .select("id,studio_id,name,photo_url")
          .eq("user_id", userId)
          .eq("is_active", true)
          .in("studio_id", studioIds),
        admin
          .from("studios")
          .select(
            "id,name,slug,business_segment,timezone,payment_policy,min_booking_notice_min",
          )
          .eq("is_active", true)
          .in("id", studioIds),
      ]);
    if (staffError) throw new Error(staffError.message);
    if (studioError) throw new Error(studioError.message);

    const staffByStudio = new Map(
      (staffRows ?? []).map((row: any) => [
        row.studio_id,
        { id: row.id, name: row.name, photoUrl: row.photo_url ?? null },
      ]),
    );
    return (studioRows ?? [])
      .map((studio: any) => {
        const staff = staffByStudio.get(studio.id) as
          | { id: string; name: string; photoUrl: string | null }
          | undefined;
        if (!staff) return null;
        return {
          id: String(studio.id),
          name: String(studio.name),
          slug: String(studio.slug),
          role: "desk_staff" as const,
          staff_id: staff.id,
          staff_name: staff.name,
          staff_photo_url: staff.photoUrl,
          business_segment: studio.business_segment ?? null,
          timezone: studio.timezone ?? null,
          payment_policy: studio.payment_policy ?? null,
          min_booking_notice_min:
            studio.min_booking_notice_min == null ? null : Number(studio.min_booking_notice_min),
        };
      })
      .filter((studio: DeskStudioShell | null): studio is DeskStudioShell => studio !== null);
  });

export const getDeskBalcaoCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertActiveDeskMembership(admin, userId, data.studioId);

    const [{ data: services, error: servicesError }, { data: staff, error: staffError }] =
      await Promise.all([
        admin
          .from("services")
          .select("id,name,price,duration_min")
          .eq("studio_id", data.studioId)
          .eq("is_active", true)
          .order("sort_order"),
        admin
          .from("staff")
          .select("id,name,current_status")
          .eq("studio_id", data.studioId)
          .eq("is_active", true)
          .order("sort_order"),
      ]);
    if (servicesError) throw new Error(servicesError.message);
    if (staffError) throw new Error(staffError.message);
    return { services: services ?? [], staff: staff ?? [] };
  });

async function assertActiveDeskMembership(admin: any, userId: string, studioId: string) {
  if (!userId) throw new Response("unauthorized", { status: 401 });
  const [{ data: membership, error: membershipError }, { data: staff, error: staffError }] =
    await Promise.all([
      admin
        .from("user_roles")
        .select("user_id")
        .eq("user_id", userId)
        .eq("studio_id", studioId)
        .eq("role", "desk_staff")
        .limit(1)
        .maybeSingle(),
      admin
        .from("staff")
        .select("id")
        .eq("user_id", userId)
        .eq("studio_id", studioId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
    ]);
  if (membershipError || staffError || !membership?.user_id || !staff?.id) {
    throw new Response("forbidden", { status: 403 });
  }
}
