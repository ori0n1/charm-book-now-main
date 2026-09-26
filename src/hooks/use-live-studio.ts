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
  normalizeStaffStatus,
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
  timezone?: string | null;
  updated_at?: string | null;
  payment_policy?: "pay_in_studio" | "pre_payment" | null;
  deposit_percent?: number | null;
  accepted_payment_methods?: string[] | null;
  stripe_connect_charges_enabled?: boolean | null;
  stripe_connect_onboarding_completed?: boolean | null;
  stripe_connect_mb_way_payments_enabled?: boolean | null;
  min_booking_notice_min?: number | null;
  public_amenities?: Json | null;
  cancellation_min_notice_hours?: number | null;
  cancellation_after_deadline_policy?: string | null;
  refund_requests_enabled?: boolean | null;
  cancellation_policy_text?: string | null;
  legal_policy_version?: string | null;
  booking_flow_mode?: "online" | "request" | null;
  booking_request_professional_mode?: "hidden" | "showcase" | "preference" | null;
  notifications_enabled?: boolean | null;
  online_payment_ready?: boolean | null;
  mb_way_payment_ready?: boolean | null;
  public_notifications_available?: boolean | null;
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
    categories: allowStaticFallback
      ? staticCategories
      : [{ id: "all", label: "Todos os serviços" }],
    professionals: allowStaticFallback ? staticProfessionals : [],
    upsellsByServiceId: {},
    ready: false,
  });

  async function load() {
    const studioSelect =
      "id,name,slug,tagline,description,timezone,brand_color,logo_url,hero_image_url,hero_gallery_urls,location,phone,whatsapp,email,instagram,rating,reviews_count,updated_at,payment_policy,accepted_payment_methods,stripe_connect_charges_enabled,stripe_connect_onboarding_completed,stripe_connect_mb_way_payments_enabled,business_segment,cancellation_min_notice_hours,cancellation_after_deadline_policy,refund_requests_enabled,cancellation_policy_text,legal_policy_version,booking_flow_mode,booking_request_professional_mode,notifications_enabled";
    const studioResult = await (supabase as any).from("public_studios")
      .select(`${studioSelect},public_amenities,min_booking_notice_min`)
      .eq("id", studioId)
      .maybeSingle();
    /*
      No base-table fallback: a failure of the public views must not turn a
      published profile query into a query against private studio settings.
    */
    const [{ data: svc }, { data: cats }, { data: links }, offersResult] =
      await Promise.all([
        loadPublicTable("public_services", "services", (query) =>
          query
            .select(
              "id,name,description,duration_min,price,is_recommended,is_active,media,category_id",
            )
            .eq("studio_id", studioId)
            .eq("is_active", true)
            .order("sort_order")
            .order("name"),
        ),
        loadPublicTable("public_service_categories", "service_categories", (query) =>
          query.select("id,label,sort_order").eq("studio_id", studioId).order("sort_order"),
        ),
        loadPublicTable(
          "public_staff_services",
          "staff_services",
          (query) => query.select("staff_id,service_id").eq("studio_id", studioId),
          (query) => query.select("staff_id,service_id"),
        ),
        loadPublicTable("public_upsell_offers", "upsell_offers", (query) =>
          query
            .select("id,trigger_service_id,offered_service_id,discounted_price,discount_type,discount_value,display_mode,duration_min,description,is_active")
            .eq("studio_id", studioId)
            .eq("is_active", true),
        ),
      ]);
    let offers = offersResult.data as any[] | null;
    if (offersResult.error) {
      const { data } = await loadPublicTable("public_upsell_offers", "upsell_offers", (query) =>
        query
          .select("id,trigger_service_id,offered_service_id,discounted_price,description,is_active")
          .eq("studio_id", studioId)
          .eq("is_active", true),
      );
      offers = data as any[] | null;
    }

    const staffResult: any = await (supabase as any).from("public_staff")
      .select("id,name,role,bio,photo_url,rating,reviews_count,is_active,current_status")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("sort_order");
    const staff = staffResult.data;
    const st = studioResult.data as Partial<LiveStudio> | null;

    const liveStudio: LiveStudio = st
      ? ({
          ...staticStudio,
          ...st,
          stripe_connect_charges_enabled:
            st.online_payment_ready ?? st.stripe_connect_charges_enabled ?? false,
          stripe_connect_onboarding_completed:
            st.online_payment_ready ?? st.stripe_connect_onboarding_completed ?? false,
          stripe_connect_mb_way_payments_enabled:
            st.mb_way_payment_ready ?? st.stripe_connect_mb_way_payments_enabled ?? false,
          notifications_enabled:
            st.public_notifications_available ?? st.notifications_enabled ?? false,
        } as LiveStudio)
      : (staticStudio as LiveStudio);

    const liveCategories: Category[] =
      cats && cats.length
        ? [
            { id: "all", label: "Todos os serviços" },
            ...cats.map((c: { id: string; label: string }) => ({ id: c.id, label: c.label })),
          ]
        : allowStaticFallback
          ? staticCategories
          : [{ id: "all", label: "Todos os serviços" }];

    const liveServices: Service[] =
      svc && svc.length
        ? svc.map(
            (s: {
              id: string;
              category_id: string | null;
              name: string;
              description: string | null;
              duration_min: number;
              price: number | string;
              is_recommended: boolean;
              media: unknown;
            }) => {
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
            },
          )
        : allowStaticFallback
          ? staticServices
          : [];

    const linkMap = new Map<string, string[]>();
    const staffRows = (staff ?? []) as Array<{ id: string }>;
    const staffIds = new Set(staffRows.map((p) => p.id));
    ((links ?? []) as Array<{ staff_id: string; service_id: string }>).forEach((l) => {
      if (!staffIds.has(l.staff_id)) return;
      const arr = linkMap.get(l.staff_id) ?? [];
      arr.push(l.service_id);
      linkMap.set(l.staff_id, arr);
    });

    const liveProfessionals: Professional[] =
      staff && staff.length
        ? staff
            .map((p: any) => ({
              id: p.id,
              name: p.name,
              role: p.role ?? "",
              rating: p.rating ? Number(p.rating) : undefined,
              reviewsCount: p.reviews_count ? Number(p.reviews_count) : undefined,
              photo: p.photo_url ?? "",
              serviceIds: linkMap.get(p.id) ?? [],
              currentStatus: normalizeStaffStatus(p.booking_availability_status ?? p.current_status),
            }))
        : allowStaticFallback
          ? staticProfessionals
          : [];

    const servicesById = new Map(liveServices.map((s) => [s.id, s]));
    const upsellsByServiceId: Record<string, LiveUpsell[]> = {};
    (offers ?? []).forEach((o: any) => {
      const offered = servicesById.get(o.offered_service_id);
      if (!offered) return;
      const photo = offered.media?.[0]?.src ?? "";
      const discountType = normalizeUpsellDiscountType(o.discount_type);
      const displayMode = normalizeUpsellDisplayMode(o.display_mode);
      const upsellDurationMin = o.duration_min == null ? null : Number(o.duration_min);
      const arr = upsellsByServiceId[o.trigger_service_id] ?? [];
      arr.push({
        id: o.id,
        offeredServiceId: o.offered_service_id,
        name: `+ ${offered.name}`,
        description: o.description ?? offered.description ?? "",
        durationMin: upsellDurationMin ?? offered.durationMin,
        upsellDurationMin,
        originalPrice: offered.price,
        price: Number(o.discounted_price),
        photo,
        discountType,
        discountValue: o.discount_value == null ? null : Number(o.discount_value),
        displayMode,
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
    // Public pages read from deliberately narrow views after the security
    // hardening migration. Those views are not Realtime publications, so a
    // small polling fallback keeps the catalogue fresh without reopening the
    // underlying tables to anonymous clients.
    const refreshInterval = window.setInterval(() => void load(), 60_000);
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
      window.clearInterval(refreshInterval);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

  return state;
}

async function loadPublicTable(
  view: string,
  legacyTable: string,
  build: (query: any) => PromiseLike<any>,
  buildLegacy: ((query: any) => PromiseLike<any>) | null = null,
) {
  const viewResult = await build((supabase as any).from(view));
  if (!viewResult.error) return viewResult;
  // Backwards-compatible only while the security migration is being rolled out.
  // Once base-table public policies are removed this fallback fails closed.
  return (buildLegacy ?? build)((supabase as any).from(legacyTable));
}

function normalizeUpsellDiscountType(value: unknown): Upsell["discountType"] {
  return value === "percent" || value === "fixed" || value === "price" ? value : "price";
}

function normalizeUpsellDisplayMode(value: unknown): Upsell["displayMode"] {
  return value === "percent" || value === "amount" || value === "both" ? value : "both";
}

// Re-export ID maps for legacy refs
export { SERVICE_DB_ID, STAFF_DB_ID };
