import { createServerClient } from "@supabase/ssr";
import {
  getCookies,
  getRequest,
  getResponseHeader,
  setCookie,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { getSupabaseServerConfig, SUPABASE_AUTH_COOKIE_NAME } from "./auth-config";
import type { Database } from "./types";

export function createRequestSupabaseClient() {
  const request = getRequest();
  const { supabaseUrl, publishableKey } = getSupabaseServerConfig();

  return createServerClient<Database>(supabaseUrl, publishableKey, {
    cookieOptions: {
      name: SUPABASE_AUTH_COOKIE_NAME,
      path: "/",
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      httpOnly: false,
    },
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, {
            ...options,
            path: "/",
            sameSite: "lax",
            secure: new URL(request.url).protocol === "https:",
            httpOnly: false,
          });
        }
        for (const [name, value] of Object.entries(headers)) {
          setResponseHeader(name, value);
        }
        setPrivateAuthResponseHeaders();
      },
    },
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function getVerifiedRequestUser() {
  const supabase = createRequestSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  return {
    supabase,
    user: error ? null : data.user,
    error,
  };
}

export function setPrivateAuthResponseHeaders() {
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("Pragma", "no-cache");
  setResponseHeader("Expires", "0");
  mergeVaryHeader("Cookie");
  mergeVaryHeader("Authorization");
}

function mergeVaryHeader(value: string) {
  const current = getResponseHeader("Vary") ?? "";
  const values = new Set(
    current
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  setResponseHeader("Vary", [...values].join(", "));
}
