import { createClient } from "@supabase/supabase-js";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSupabaseServerConfig } from "./auth-config";
import { getVerifiedRequestUser, setPrivateAuthResponseHeaders } from "./server-client";
import type { Database } from "./types";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    setPrivateAuthResponseHeaders();

    const authHeader = request.headers.get("authorization");
    if (authHeader && !authHeader.startsWith("Bearer ")) {
      unauthorized();
    }

    const bearerToken = authHeader?.slice("Bearer ".length).trim() || null;
    if (bearerToken) {
      const verified = await verifyBearerClaims(bearerToken);
      if (!verified.claims?.sub) unauthorized();
      return next({
        context: {
          supabase: verified.supabase,
          userId: String(verified.claims.sub),
          claims: verified.claims,
        },
      });
    }

    const verified = await getVerifiedRequestUser();
    if (!verified.user) unauthorized();
    const { data: verifiedClaims, error: claimsError } = await verified.supabase.auth.getClaims();
    if (claimsError || !verifiedClaims?.claims?.sub || verifiedClaims.claims.sub !== verified.user.id) {
      unauthorized();
    }
    return next({
      context: {
        supabase: verified.supabase,
        userId: verified.user.id,
        claims: verifiedClaims.claims,
      },
    });
  },
);

async function verifyBearerClaims(token: string) {
  const { supabaseUrl, publishableKey } = getSupabaseServerConfig();
  const supabase = createClient<Database>(supabaseUrl, publishableKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  return { supabase, claims: error ? null : data?.claims, error };
}

function unauthorized(): never {
  throw Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Authorization",
      },
    },
  );
}
