import { SUPABASE_AUTH_COOKIE_NAME } from "./auth-config";

export const AUTH_CSRF_COOKIE_NAME = "bellza.csrf";
export const AUTH_CSRF_HEADER_NAME = "x-bellza-csrf";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function getOrCreateBrowserCsrfToken() {
  if (typeof document === "undefined") return null;

  const existing = readCookieValue(document.cookie, AUTH_CSRF_COOKIE_NAME);
  if (isValidCsrfToken(existing)) return existing;

  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Lax; Max-Age=${CSRF_MAX_AGE_SECONDS}${secure}`;
  return token;
}

export function hasSupabaseAuthCookie(cookieHeader: string | null) {
  if (!cookieHeader) return false;
  return parseCookieNames(cookieHeader).some(
    (name) => name === SUPABASE_AUTH_COOKIE_NAME || name.startsWith(`${SUPABASE_AUTH_COOKIE_NAME}.`),
  );
}

export function validateCookieMutationCsrf(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return { ok: true as const };
  }

  const cookieHeader = request.headers.get("cookie");
  if (!hasSupabaseAuthCookie(cookieHeader)) {
    return { ok: true as const };
  }

  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(request.url).origin;
  if (!origin || origin !== expectedOrigin) {
    return { ok: false as const, reason: "csrf_origin_mismatch" };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return { ok: false as const, reason: "csrf_cross_site_request" };
  }

  const cookieToken = readCookieValue(cookieHeader ?? "", AUTH_CSRF_COOKIE_NAME);
  const headerToken = request.headers.get(AUTH_CSRF_HEADER_NAME);
  if (!isValidCsrfToken(cookieToken) || !isValidCsrfToken(headerToken)) {
    return { ok: false as const, reason: "csrf_token_missing" };
  }
  if (!constantTimeEqual(cookieToken, headerToken)) {
    return { ok: false as const, reason: "csrf_token_mismatch" };
  }

  return { ok: true as const };
}

export function assertCookieMutationCsrf(request: Request) {
  const result = validateCookieMutationCsrf(request);
  if (!result.ok) {
    throw new Response(result.reason, {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

function readCookieValue(cookieHeader: string, name: string) {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const candidateName = part.slice(0, separator).trim();
    if (candidateName !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

function parseCookieNames(cookieHeader: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.slice(0, Math.max(part.indexOf("="), 0)).trim())
    .filter(Boolean);
}

function isValidCsrfToken(value: string | null): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function constantTimeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
