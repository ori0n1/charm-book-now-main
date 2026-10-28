import type { GooglePlace, GoogleReviewsState } from "./google-places.types";

type Dependencies = {
  sb: { from: (table: string) => any };
  enabled: boolean;
  apiKey?: string;
  testBudget?: boolean;
  fetch: typeof fetch;
  quota: (key: string, limit: number, windowMs: number) => Promise<void>;
  entitled: (studioId: string) => Promise<void>;
};
const placeIdPattern = /^[A-Za-z0-9_-]{1,255}$/;
const empty = (status: GoogleReviewsState["status"]): GoogleReviewsState => ({
  status,
  rating: null,
  count: 0,
  reviews: [],
  mapsUri: null,
});
const googleUri = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "google.com" || url.hostname.endsWith(".google.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
};

// Only in-flight requests are shared. Successful Google content is never cached.
// The permanent Place ID mapping is the policy-permitted cache.
const inFlight = new Map<string, Promise<GoogleReviewsState>>();
export function createGooglePlacesService(deps: Dependencies) {
  const enabled = () => deps.enabled && Boolean(deps.apiKey);
  async function owner(userId: string, studioId: string) {
    const { data, error } = await deps.sb
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("studio_id", studioId)
      .in("role", ["studio_owner", "saas_owner"])
      .limit(1)
      .maybeSingle();
    if (!userId || error || !data?.role)
      throw new Response("studio_owner_required", { status: 403 });
  }
  async function mapping(studioId: string) {
    const { data, error } = await deps.sb
      .from("studio_google_places")
      .select("place_id")
      .eq("studio_id", studioId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar o estabelecimento Google.");
    return data?.place_id as string | undefined;
  }
  async function request(path: string, fields: string, body?: object) {
    if (!enabled()) throw new Error("Avaliações Google indisponíveis.");
    // Staging trial: at most 20 calls across the entire test campaign, not per day.
    // Long-lived durable counter also survives process restarts and failed requests.
    if (deps.testBudget)
      await deps.quota("google-places:trial:20261001", 20, 315_360_000_000);
    await deps.quota("google-places:global:daily", 500, 86_400_000);
    const response = await deps.fetch(`https://places.googleapis.com/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "X-Goog-Api-Key": deps.apiKey!,
        "X-Goog-FieldMask": fields,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(6000),
    });
    // Never relay upstream error bodies (which can contain request metadata).
    if (!response.ok)
      throw new Error("Não foi possível consultar o Google. Tente novamente mais tarde.");
    return response.json() as Promise<any>;
  }
  async function details(placeId: string) {
    return request(
      `places/${encodeURIComponent(placeId)}?languageCode=pt-PT`,
      "id,displayName,formattedAddress,rating,userRatingCount,reviews,googleMapsUri",
    );
  }
  return {
    async status(userId: string, studioId: string) {
      await owner(userId, studioId);
      if (!enabled()) return { enabled: false, placeId: null };
      return { enabled: true, placeId: (await mapping(studioId)) ?? null };
    },
    async search(userId: string, studioId: string, query: string): Promise<GooglePlace[]> {
      await owner(userId, studioId);
      await deps.entitled(studioId);
      const textQuery = query.trim();
      if (textQuery.length < 3 || textQuery.length > 120)
        throw new Error("Indique pelo menos 3 caracteres.");
      await deps.quota(`google-places:search:${studioId}`, 10, 60_000);
      const result = await request(
        "places:searchText",
        "places.id,places.displayName,places.formattedAddress",
        { textQuery, languageCode: "pt-PT", pageSize: 10 },
      );
      return (result.places ?? [])
        .filter((p: any) => placeIdPattern.test(p.id))
        .map((p: any) => ({
          id: p.id,
          name: p.displayName?.text ?? "",
          address: p.formattedAddress ?? "",
        }));
    },
    async connect(userId: string, studioId: string, placeId: string) {
      await owner(userId, studioId);
      await deps.entitled(studioId);
      if (!placeIdPattern.test(placeId)) throw new Error("Estabelecimento inválido.");
      await deps.quota(`google-places:connect:${studioId}`, 5, 60_000);
      const place = await request(
        `places/${encodeURIComponent(placeId)}?languageCode=pt-PT`,
        "id,displayName,formattedAddress",
      );
      if (place.id !== placeId) throw new Error("Estabelecimento inválido.");
      const { error } = await deps.sb
        .from("studio_google_places")
        .upsert({ studio_id: studioId, place_id: placeId }, { onConflict: "studio_id" });
      if (error) throw new Error("Não foi possível guardar o estabelecimento.");
      return { placeId };
    },
    async disconnect(userId: string, studioId: string) {
      await owner(userId, studioId);
      // Disconnect remains possible during Google outages and feature rollback.
      const { error } = await deps.sb
        .from("studio_google_places")
        .delete()
        .eq("studio_id", studioId);
      if (error) throw new Error("Não foi possível desconectar o Google.");
      return { placeId: null };
    },
    async publicReviews(studioId: string): Promise<GoogleReviewsState> {
      if (!enabled()) return empty("disabled");
      try {
        try {
          await deps.entitled(studioId);
        } catch {
          return empty("disabled");
        }
        const { data: studio, error } = await deps.sb
          .from("studios")
          .select("id")
          .eq("id", studioId)
          .eq("is_active", true)
          .maybeSingle();
        if (error || !studio) return empty("disabled");
        const placeId = await mapping(studioId);
        if (!placeId) return empty("disconnected");
        const key = `${studioId}:${placeId}`;
        let pending = inFlight.get(key);
        if (!pending) {
          pending = (async () => {
            try {
              // Durable quota: at most 60 details requests per tenant/hour.
              await deps.quota(`google-places:details:${studioId}`, 60, 3_600_000);
              const place = await details(placeId);
              // A disconnect/change during a request must not publish old content.
              if ((await mapping(studioId)) !== placeId) return empty("disconnected");
              return {
                status: "available" as const,
                rating: typeof place.rating === "number" ? place.rating : null,
                count: typeof place.userRatingCount === "number" ? place.userRatingCount : 0,
                mapsUri: googleUri(place.googleMapsUri),
                reviews: (place.reviews ?? []).map((r: any, i: number) => ({
                  id: r.name ?? String(i),
                  rating: Number(r.rating) || 0,
                  text: r.originalText?.text ?? r.text?.text ?? "",
                  author: r.authorAttribution?.displayName ?? "Autor Google",
                  authorUri: googleUri(r.authorAttribution?.uri),
                  publishedAt: r.publishTime ?? "",
                  uri: googleUri(r.googleMapsUri),
                })),
              };
            } catch {
              return empty("unavailable");
            }
          })();
          inFlight.set(key, pending);
          void pending.finally(() => inFlight.delete(key));
        }
        return await pending;
      } catch {
        return empty("unavailable");
      }
    },
  };
}
