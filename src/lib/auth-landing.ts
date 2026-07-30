import type { Session } from "@supabase/supabase-js";
import { recordAuthDebugEvent, supabase } from "@/integrations/supabase/client";

export type AuthLandingPath = "/admin" | "/admin/agenda" | "/admin/balcao" | "/admin/premium" | "/onboarding";

type RoleRow = {
  role: string | null;
  studio_id: string | null;
  studios:
    | {
        id: string;
        subscription_status?: string | null;
        subscription_current_period_end?: string | null;
        premium_access_until?: string | null;
        trial_ends_at?: string | null;
        onboarding_completed_at?: string | null;
      }
    | null;
};

type SubscriptionRow = {
  studio_id: string | null;
  status: string | null;
  current_period_end: string | null;
};

export async function getSettledSession(maxAttempts = 8): Promise<Session | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.getSession();
    if (data.session) {
      recordAuthDebugEvent({
        kind: "session_settled",
        message: `attempt=${attempt + 1}`,
      });
      return data.session;
    }
    if (error && attempt === maxAttempts - 1) throw error;
    await delay(150);
  }
  recordAuthDebugEvent({ kind: "session_missing_after_settle" });
  return null;
}

export async function settleSessionFromCurrentUrl(
  cleanPath?: string,
  options: { forceCodeExchange?: boolean } = {},
): Promise<Session | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  recordAuthDebugEvent({
    kind: "settle_current_url",
    url: `${url.origin}${url.pathname}`,
    message: JSON.stringify({
      hasCode: Boolean(code),
      hashKeys: [...hash.keys()],
      cleanPath: cleanPath ?? window.location.pathname,
      forceCodeExchange: Boolean(options.forceCodeExchange),
    }),
  });

  if (code) {
    const codeKey = `bellza:pkce-code:${code}`;
    const alreadyHandled = sessionStorage.getItem(codeKey) === "1";
    const currentSession = options.forceCodeExchange ? null : await getSettledSession(1);
    window.history.replaceState({}, document.title, cleanPath ?? window.location.pathname);

    if (currentSession) return currentSession;

    if (alreadyHandled) {
      return getSettledSession();
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    recordAuthDebugEvent({
      kind: "exchange_code_for_session",
      url: `${url.origin}${url.pathname}`,
      ok: !error,
      message: error?.message,
    });
    if (error) {
      const existingSession = await getSettledSession(2);
      const message = error.message.toLowerCase();
      const isDuplicatePkceExchange =
        message.includes("code verifier") ||
        message.includes("invalid flow state") ||
        message.includes("auth code");

      if (existingSession && isDuplicatePkceExchange) return existingSession;
      sessionStorage.removeItem(codeKey);
      throw error;
    }
    sessionStorage.setItem(codeKey, "1");
  }

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    recordAuthDebugEvent({
      kind: "set_session_from_hash",
      url: `${url.origin}${url.pathname}`,
      ok: !error,
      message: error?.message,
    });
    window.history.replaceState({}, document.title, cleanPath ?? window.location.pathname);
    if (error) throw error;
    return getSettledSession();
  }

  if (window.location.hash) {
    window.history.replaceState({}, document.title, cleanPath ?? window.location.pathname);
  }

  return getSettledSession();
}

export async function resolveAuthLanding(userId: string): Promise<AuthLandingPath> {
  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select(
      "role,studio_id,studios:studio_id(id,subscription_status,subscription_current_period_end,premium_access_until,trial_ends_at,onboarding_completed_at)",
    )
    .eq("user_id", userId);

  if (rolesError) throw rolesError;

  const studioRoles = normalizeRoleRows(roles).filter((row) => row.studio_id && row.studios?.id);
  if (studioRoles.length === 0) {
    const subscription = await loadCurrentSubscription(userId);
    return hasUsableSubscription(subscription) ? "/admin/agenda" : "/onboarding";
  }

  const primary = studioRoles[0];
  const subscription = await loadCurrentSubscription(userId, primary.studio_id);
  const access = resolveAccess(primary.studios, subscription);

  if (access === "expired") return "/admin/premium";
  return resolveRoleLanding(studioRoles);
}

function normalizeRoleRows(value: unknown): RoleRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const candidate = row as RoleRow;
    const studioValue = Array.isArray(candidate.studios) ? candidate.studios[0] : candidate.studios;
    return { ...candidate, studios: studioValue ?? null };
  });
}

async function loadCurrentSubscription(userId: string, studioId?: string | null) {
  let query = (supabase as any)
    .from("subscriptions")
    .select("studio_id,status,current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "checkout_pending"])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (studioId) query = query.eq("studio_id", studioId);

  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data as SubscriptionRow | null;
}

function resolveAccess(studio: RoleRow["studios"], subscription: SubscriptionRow | null) {
  const now = Date.now();
  const studioStatus = studio?.subscription_status ?? "";
  const studioPeriodEnd = time(studio?.subscription_current_period_end);
  const premiumUntil = time(studio?.premium_access_until);
  const trialEndsAt = time(studio?.trial_ends_at);
  const subscriptionStatus = subscription?.status ?? "";
  const subscriptionPeriodEnd = time(subscription?.current_period_end);

  const trialActive =
    (studioStatus === "trialing" && trialEndsAt > now) ||
    (subscriptionStatus === "trialing" && (subscriptionPeriodEnd === 0 || subscriptionPeriodEnd > now));
  const premiumActive =
    ((studioStatus === "active" || subscriptionStatus === "active") &&
      (studioPeriodEnd === 0 ||
        studioPeriodEnd > now ||
        premiumUntil > now ||
        subscriptionPeriodEnd === 0 ||
        subscriptionPeriodEnd > now)) ||
    premiumUntil > now;

  if (trialActive || premiumActive) return "active";

  const hasExpiredTrial = studioStatus === "trialing" && trialEndsAt > 0 && trialEndsAt <= now;
  const hasExpiredSubscription =
    ["active", "trialing"].includes(subscriptionStatus) && subscriptionPeriodEnd > 0 && subscriptionPeriodEnd <= now;

  return hasExpiredTrial || hasExpiredSubscription ? "expired" : "active";
}

function hasUsableSubscription(subscription: SubscriptionRow | null) {
  if (!subscription) return false;
  if (subscription.status === "checkout_pending") return true;
  if (!["active", "trialing"].includes(subscription.status ?? "")) return false;
  const end = time(subscription.current_period_end);
  return end === 0 || end > Date.now();
}

function resolveRoleLanding(roles: RoleRow[]): AuthLandingPath {
  const roleNames = roles.map((role) => role.role ?? "");
  if (roleNames.length > 0 && roleNames.every((role) => role === "desk_staff")) return "/admin/balcao";
  if (roleNames.length > 0 && roleNames.every((role) => role === "staff" || role === "desk_staff")) {
    return "/admin/agenda";
  }
  return "/admin/agenda";
}

function time(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
