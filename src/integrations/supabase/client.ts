import { createBrowserClient } from "@supabase/ssr";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  getSupabaseServerConfig,
  LEGACY_AUTH_STORAGE_KEYS,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
  SUPABASE_AUTH_COOKIE_NAME,
} from "./auth-config";
import type { Database } from "./types";

type SessionTokens = Pick<Session, "access_token" | "refresh_token">;

const MIGRATION_STATE_KEY = "bellza.auth.cookie-migration";
const MIGRATION_RETRY_DELAY_MS = 5 * 60 * 1000;
let migrationInFlight: Promise<boolean> | undefined;

function createSupabaseClient() {
  if (typeof window === "undefined") {
    const { supabaseUrl, publishableKey } = getSupabaseServerConfig();
    return createClient<Database>(
      supabaseUrl,
      publishableKey,
      {
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }

  return createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: {
      name: SUPABASE_AUTH_COOKIE_NAME,
      path: "/",
      sameSite: "lax",
      secure: window.location.protocol === "https:",
      httpOnly: false,
    },
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let client: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, property, receiver) {
    if (!client) client = createSupabaseClient();
    return Reflect.get(client, property, receiver);
  },
});

/**
 * Moves a legacy localStorage session into the SSR cookie storage once. The
 * legacy keys are deleted only after the same-origin server has independently
 * validated the cookie-backed session with Supabase Auth.
 */
export async function ensureBrowserAuthReady() {
  if (typeof window === "undefined") return false;
  removeDeprecatedAuthDebugStorage();

  if (migrationInFlight) return migrationInFlight;
  migrationInFlight = runWithMigrationLock(migrateLegacySession);
  try {
    return await migrationInFlight;
  } finally {
    migrationInFlight = undefined;
  }
}

async function migrateLegacySession() {
  const { data: cookieSession } = await supabase.auth.getSession();
  if (cookieSession.session) {
    const verified = await verifyCookieSession();
    if (verified) clearLegacyAuthStorage();
    return verified;
  }

  const legacyTokens = readLegacySessionTokens();
  if (!legacyTokens || migrationAttemptIsCoolingDown()) return false;

  const { error } = await supabase.auth.setSession(legacyTokens);
  if (error) {
    rememberMigrationFailure(error.name || "session_migration_failed");
    return false;
  }

  const verified = await verifyCookieSession();
  if (!verified) {
    rememberMigrationFailure("server_session_not_verified");
    return false;
  }

  clearLegacyAuthStorage();
  clearMigrationFailure();
  return true;
}

async function verifyCookieSession() {
  try {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { authenticated?: unknown; userId?: unknown };
    return payload.authenticated === true && typeof payload.userId === "string";
  } catch {
    return false;
  }
}

function readLegacySessionTokens(): SessionTokens | null {
  for (const key of LEGACY_AUTH_STORAGE_KEYS) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return null;
    }
    if (!raw || raw.length > 128_000) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      const candidate = sessionCandidate(parsed);
      if (candidate) return candidate;
    } catch {
      // A malformed legacy value is left untouched for manual recovery.
    }
  }
  return null;
}

function sessionCandidate(value: unknown): SessionTokens | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record.currentSession ?? record.session;
  if (nested && nested !== value) {
    const candidate = sessionCandidate(nested);
    if (candidate) return candidate;
  }

  const accessToken = record.access_token;
  const refreshToken = record.refresh_token;
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    accessToken.length < 20 ||
    refreshToken.length < 20 ||
    accessToken.length > 16_384 ||
    refreshToken.length > 16_384
  ) {
    return null;
  }
  return { access_token: accessToken, refresh_token: refreshToken };
}

function clearLegacyAuthStorage() {
  try {
    for (const key of LEGACY_AUTH_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Cookies remain authoritative even if hardened storage cannot be cleaned.
  }
}

function removeDeprecatedAuthDebugStorage() {
  try {
    window.localStorage.removeItem(["bellza", "auth-debug-events"].join(":"));
  } catch {
    // Diagnostics cleanup is best effort.
  }
}

function migrationAttemptIsCoolingDown() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(MIGRATION_STATE_KEY) ?? "null") as {
      at?: unknown;
    } | null;
    return typeof parsed?.at === "number" && Date.now() - parsed.at < MIGRATION_RETRY_DELAY_MS;
  } catch {
    return false;
  }
}

function rememberMigrationFailure(reason: string) {
  try {
    window.sessionStorage.setItem(
      MIGRATION_STATE_KEY,
      JSON.stringify({ at: Date.now(), reason: sanitizeReason(reason) }),
    );
  } catch {
    // Failure state is non-essential and contains no token or user data.
  }
}

function clearMigrationFailure() {
  try {
    window.sessionStorage.removeItem(MIGRATION_STATE_KEY);
  } catch {
    // ignore unavailable storage
  }
}

function sanitizeReason(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 48);
}

async function runWithMigrationLock(task: () => Promise<boolean>) {
  if (typeof navigator.locks?.request !== "function") return task();
  return navigator.locks.request("bellza-auth-cookie-migration", task);
}
