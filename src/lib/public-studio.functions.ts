import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export type PublicStudioSeo = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  location: string | null;
  logoUrl: string | null;
  updatedAt: string | null;
  bookingFlowMode: "online" | "request";
};

function getPublicSupabaseClient() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Configuração pública do Supabase indisponível.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export const getPublicStudioSeo = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]*$/) }).parse(input),
  )
  .handler(async ({ data }): Promise<PublicStudioSeo | null> => {
    const client = getPublicSupabaseClient();
    let { data: studio, error } = await (client as any)
      .from("public_booking_studios")
      .select("id,slug,name,tagline,description,location,logo_url,updated_at,booking_flow_mode")
      .eq("slug", data.slug)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      ({ data: studio, error } = await (client as any)
        .from("public_studios")
        .select("id,slug,name,tagline,description,location,logo_url,updated_at")
        .eq("slug", data.slug)
        .eq("is_active", true)
        .maybeSingle());
    }

    if (error) {
      console.error("public_studio_seo_query_failed", error.message);
      throw new Error("Não foi possível carregar o estúdio.");
    }
    if (!studio) return null;

    return {
      id: String(studio.id),
      slug: String(studio.slug),
      name: String(studio.name),
      tagline: typeof studio.tagline === "string" ? studio.tagline : null,
      description: typeof studio.description === "string" ? studio.description : null,
      location: typeof studio.location === "string" ? studio.location : null,
      logoUrl: typeof studio.logo_url === "string" ? studio.logo_url : null,
      updatedAt: typeof studio.updated_at === "string" ? studio.updated_at : null,
      bookingFlowMode: studio.booking_flow_mode === "request" ? "request" : "online",
    };
  });
