import type { User } from "@supabase/supabase-js";

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

function sanitizePublicReturnTo(value: string | null) {
  if (!value || !value.startsWith("/s/")) return null;
  if (value.includes("//") || value.includes("\\") || value.startsWith("/admin")) return null;
  return value;
}
