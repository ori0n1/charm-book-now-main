import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { assertStudioEntitlement } from "@/lib/server-security";
import { createGooglePlacesService } from "./google-places.server";

const input = z.object({ studioId: z.string().uuid() });
function service() {
  const sb = getAdminClient();
  return createGooglePlacesService({
    sb,
    enabled: process.env.GOOGLE_PLACES_ENABLED === "true",
    apiKey: process.env.GOOGLE_PLACES_API_KEY,
    testBudget: process.env.GOOGLE_PLACES_TEST_BUDGET === "true",
    fetch: (...args) => fetch(...args),
    quota: async (key, limit, windowMs) => {
      // Fail closed: an unavailable quota store must never cause unbounded bills.
      const { data, error } = await sb
        .rpc("consume_rate_limit", {
          p_key: key,
          p_limit: limit,
          p_window_seconds: Math.ceil(windowMs / 1000),
        })
        .maybeSingle();
      const result = z.object({ allowed: z.boolean() }).safeParse(data);
      if (error || !result.success || !result.data.allowed)
        throw new Error("Limite de consultas Google atingido. Tente mais tarde.");
    },
    entitled: (studioId) => assertStudioEntitlement(sb, studioId, "reviews"),
  });
}
export const getGooglePlaceConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => input.parse(value))
  .handler(({ data, context }) => service().status(context.userId, data.studioId));
export const searchGooglePlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) =>
    input.extend({ query: z.string().trim().min(3).max(120) }).parse(value),
  )
  .handler(({ data, context }) => service().search(context.userId, data.studioId, data.query));
export const connectGooglePlace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) =>
    input.extend({ placeId: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/) }).parse(value),
  )
  .handler(({ data, context }) => service().connect(context.userId, data.studioId, data.placeId));
export const disconnectGooglePlace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => input.parse(value))
  .handler(({ data, context }) => service().disconnect(context.userId, data.studioId));
export const getGooglePlaceReviews = createServerFn({ method: "POST" })
  .inputValidator((value) => input.parse(value))
  .handler(({ data }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    return service().publicReviews(data.studioId);
  });
