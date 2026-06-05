// Subscribes to public studio data (services, staff, categories, upsells, studio fields)
// and returns live-updating arrays. Falls back to provided defaults when DB is empty.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  studio as staticStudio,
  services as staticServices,
  categories as staticCategories,
  professionals as staticProfessionals,
  type Service,
  type Professional,
  type Category,
  type Upsell,
  SERVICE_DB_ID,
  STAFF_DB_ID,
} from "@/data/studio";
import type { Json } from "@/integrations/supabase/types";

type LiveStudio = typeof staticStudio & {
  brand_color?: string | null;
  logo_url?: string | null;
  hero_image_url?: string | null;
  hero_gallery_urls?: Json | null;
  whatsapp?: string | null;
  phone?: string | null;
  instagram?: string | null;
  description?: string | null;
  updated_at?: string | null;
  payment_policy?: "pay_in_studio" | "pre_payment" | null;
  deposit_percent?: number | null;
  accepted_payment_methods?: string[] | null;
  min_booking_notice_min?: number | null;
  public_amenities?: Json | null;
  cancellation_min_notice_hours?: number | null;
  cancellation_after_deadline_policy?: string | null;
  refund_requests_enabled?: boolean | null;
  cancellation_policy_text?: string | null;
  legal_policy_version?: string | null;
};

type LiveUpsell = Upsell & { offeredServiceId: string };

type LiveData = {
  studio: LiveStudio;
  services: Service[];
  categories: Category[];
  professionals: Professional[];
  upsellsByServiceId: Record<string, LiveUpsell[]>;
  ready: boolean;
};

export function useLiveStudio(studioId: string = staticStudio.id): LiveData {
  const allowStaticFallback = studioId === staticStudio.id;
  const [state, setState] = useState<LiveData>({
    studio: staticStudio as LiveStudio,
    services: allowStaticFallback ? staticServices : [],
    categories: allowStaticFallback ? staticCategories : [{ id: "all", label: "Todos" }],
    professionals: allowStaticFallback ? staticProfessionals : [],
    upsellsByServiceId: {},
    ready: false,
  });

  async function load() {
    const studioSelect =
      "id,name,slug,tagline,description,brand_color,logo_url,hero_image_url,hero_gallery_urls,location,phone,whatsapp,email,instagram,rating,reviews_count,updated_at,payment_policy,accepted_payment_methods,business_segment,cancellation_min_notice_hours,cancellation_after_deadline_policy,refund_requests_enabled,cancellation_policy_text,legal_policy_version";
    const legacyStudioSelect =
      "id,name,slug,tagline,description,brand_color,logo_url,hero_image_url,location,phone,whatsapp,email,instagram,rating,reviews_count,updated_at,payment_policy,accepted_payment_methods,business_segment";
    let studioResult = await supabase
      .from("studios")
      .select(`${studioSelect},public_amenities,min_booking_notice_min`)
      .eq("id", studioId)
      .maybeSingle();
    if (studioResult.error) {
      studioResult = await supabase
        .from("studios")
        .select(`${legacyStudioSelect},public_amenities`)
        .eq("id", studioId)
        .maybeSingle();
    }
    if (studioResult.error) {
      studioResult = await supabase
        .from("studios")
        .select(legacyStudioSelect)
        .eq("id", studioId)
        .maybeSingle();
    }
    const [{ data: svc }, { data: cats }, { data: staff }, { data: links }, { data: offers }] =
      await Promise.all([
        supabase
          .from("services")
          .select(
            "id,name,description,duration_min,price,is_recommended,is_active,media,category_id",
          )
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .order("sort_order")
          .order("name"),
        supabase
          .from("service_categories")
          .select("id,label,sort_order")
          .eq("studio_id", studioId)
          .order("sort_order"),
        supabase
          .from("staff")
          .select("id,name,role,bio,photo_url,rating,is_active")
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .order("sort_order"),
        supabase.from("staff_services").select("staff_id,service_id"),
        supabase
          .from("upsell_offers")
          .select("id,trigger_service_id,offered_service_id,discounted_price,description,is_active")
          .eq("studio_id", studioId)
          .eq("is_active", true),
      ]);
    const st = studioResult.data;

    const liveStudio: LiveStudio = st
      ? ({ ...staticStudio, ...st } as LiveStudio)
      : (staticStudio as LiveStudio);

    const liveCategories: Category[] =
      cats && cats.length
        ? [{ id: "all", label: "Todos" }, ...cats.map((c) => ({ id: c.id, label: c.label }))]
        : allowStaticFallback
          ? staticCategories
          : [{ id: "all", label: "Todos" }];

    const liveServices: Service[] =
      svc && svc.length
        ? svc.map((s) => {
            const media = (s.media as unknown as { type: "image" | "video"; src: string }[]) ?? [];
            return {
              id: s.id,
              category: s.category_id ?? "all",
              name: s.name,
              description: s.description ?? undefined,
              durationMin: s.duration_min,
              price: Number(s.price),
              recommended: s.is_recommended,
              media,
            };
          })
        : allowStaticFallback
          ? staticServices
          : [];

    const linkMap = new Map<string, string[]>();
    const staffIds = new Set((staff ?? []).map((p) => p.id));
    (links ?? []).forEach((l) => {
      if (!staffIds.has(l.staff_id)) return;
      const arr = linkMap.get(l.staff_id) ?? [];
      arr.push(l.service_id);
      linkMap.set(l.staff_id, arr);
    });

    const liveProfessionals: Professional[] =
      staff && staff.length
        ? staff.map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role ?? "",
            rating: p.rating ? Number(p.rating) : undefined,
            photo: p.photo_url ?? "",
            serviceIds: linkMap.get(p.id) ?? [],
          }))
        : allowStaticFallback
          ? staticProfessionals
          : [];

    const servicesById = new Map(liveServices.map((s) => [s.id, s]));
    const upsellsByServiceId: Record<string, LiveUpsell[]> = {};
    (offers ?? []).forEach((o) => {
      const offered = servicesById.get(o.offered_service_id);
      if (!offered) return;
      const photo = offered.media?.[0]?.src ?? "";
      const arr = upsellsByServiceId[o.trigger_service_id] ?? [];
      arr.push({
        id: o.id,
        offeredServiceId: o.offered_service_id,
        name: `+ ${offered.name}`,
        description: o.description ?? offered.description ?? "",
        durationMin: offered.durationMin,
        originalPrice: offered.price,
        price: Number(o.discounted_price),
        photo,
      });
      upsellsByServiceId[o.trigger_service_id] = arr;
    });

    setState({
      studio: liveStudio,
      services: liveServices,
      categories: liveCategories,
      professionals: liveProfessionals,
      upsellsByServiceId,
      ready: true,
    });
  }

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`studio-${studioId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "services", filter: `studio_id=eq.${studioId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff", filter: `studio_id=eq.${studioId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_categories",
          filter: `studio_id=eq.${studioId}`,
        },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "studios", filter: `id=eq.${studioId}` },
        () => load(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_services" }, () =>
        load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `studio_id=eq.${studioId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "booking_payment_requests",
          filter: `studio_id=eq.${studioId}`,
        },
        () => load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "upsell_offers",
          filter: `studio_id=eq.${studioId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

  return state;
}

// Re-export ID maps for legacy refs
export { SERVICE_DB_ID, STAFF_DB_ID };
