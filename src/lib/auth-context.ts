import type { User } from "@supabase/supabase-js";
import type { AuthLandingPath } from "@/lib/auth-landing";
import { supabase } from "@/integrations/supabase/client";

export const PUBLIC_AUTH_CONTEXT_KEY = "bellza.auth.context";
export const PUBLIC_RETURN_TO_KEY = "bellza.public.returnTo";

export function isPublicCustomerUser(user?: Pick<User, "user_metadata"> | null) {
  const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
  return (
    metadata.account_type === "customer" ||
    metadata.bellza_account_type === "customer" ||
    metadata.role === "customer"
  );
}

export function buildPublicAuthCallbackUrl(origin: string) {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("context", "public");
  return url.toString();
}

export function rememberPublicAuthReturn(path: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PUBLIC_AUTH_CONTEXT_KEY, "public");
    window.localStorage.setItem(PUBLIC_RETURN_TO_KEY, path);
  } catch {
    // Local storage can be unavailable in hardened browsers. The callback
    // still carries context=public, so it will never fall into admin onboarding.
  }
}

export function readAndClearPublicAuthContext() {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(PUBLIC_AUTH_CONTEXT_KEY);
    window.localStorage.removeItem(PUBLIC_AUTH_CONTEXT_KEY);
    return value === "public" ? "public" : null;
  } catch {
    return null;
  }
}

export function readAndClearPublicReturnTo() {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(PUBLIC_RETURN_TO_KEY);
    window.localStorage.removeItem(PUBLIC_RETURN_TO_KEY);
    return sanitizePublicReturnTo(stored);
  } catch {
    return null;
  }
}

export function resolveAuthCallbackDestination(input: {
  landing: AuthLandingPath;
  callbackContext: "public" | null;
  publicReturnTo: string | null;
}) {
  // The route that initiated authentication owns the navigation context.
  // A validated studio role still remains a studio role, but it must not turn
  // an explicit public sign-in into an administrative navigation.
  if (input.callbackContext === "public") {
    return {
      destination: input.publicReturnTo ?? "/",
      accountType: input.landing === "/onboarding" ? ("customer" as const) : ("studio" as const),
    };
  }

  if (input.landing !== "/onboarding") {
    return {
      destination: input.landing,
      accountType: "studio" as const,
    };
  }

  return {
    destination: input.landing,
    accountType: null,
  };
}

export function withValidatedAccountType(
  metadata: Record<string, unknown>,
  accountType: "studio" | "customer",
) {
  return {
    ...metadata,
    account_type: accountType,
    bellza_account_type: accountType,
  };
}

export async function syncCurrentSessionAccountType(
  accountType: "studio" | "customer",
) {
  try {
    const { data } = await supabase.auth.getUser();
    const metadata = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    if (
      metadata.account_type === accountType &&
      metadata.bellza_account_type === accountType
    ) {
      return true;
    }

    const { error } = await supabase.auth.updateUser({
      data: withValidatedAccountType(metadata, accountType),
    });
    return !error;
  } catch {
    // Database roles remain authoritative; metadata repair is best-effort.
    return false;
  }
}

function sanitizePublicReturnTo(value: string | null) {
  if (!value || !value.startsWith("/s/")) return null;
  if (value.includes("//") || value.includes("\\") || value.startsWith("/admin")) return null;
  return value;
}
