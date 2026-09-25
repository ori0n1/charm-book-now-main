import type { SubscriptionPlanId } from "@/lib/subscription-plans.server";
import { getOrCreateBrowserCsrfToken } from "@/integrations/supabase/auth-csrf";

export type BillingAction =
  | SubscriptionPlanId
  | "free"
  | "manage"
  | "cancel"
  | "reactivate"
  | "sync"
  | null;

export class PlatformCheckoutError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 500) {
    super(code);
    this.name = "PlatformCheckoutError";
    this.code = code;
    this.status = status;
  }
}

export function isPaidPlanWorking(
  workingAction: BillingAction,
  planId: SubscriptionPlanId | null,
) {
  return planId !== null && workingAction === planId;
}

export function createCheckoutAttemptId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeStripeBillingUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "checkout.stripe.com" && url.hostname !== "billing.stripe.com")
  ) {
    throw new PlatformCheckoutError("invalid_stripe_redirect", 502);
  }
  return url.href;
}

export async function requestPlatformCheckout(input: {
  studioId?: string | null;
  plan: SubscriptionPlanId;
  checkoutAttemptId?: string;
}) {
  const { ensureBrowserAuthReady, supabase } = await import("@/integrations/supabase/client");
  await ensureBrowserAuthReady();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new PlatformCheckoutError("unauthorized", 401);

  const csrfToken = getOrCreateBrowserCsrfToken();
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  if (csrfToken) headers["x-bellza-csrf"] = csrfToken;

  const response = await fetch("/api/create-checkout-session", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({
      studioId: input.studioId ?? undefined,
      plan: input.plan,
      checkoutAttemptId: input.checkoutAttemptId ?? createCheckoutAttemptId(),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    url?: string | null;
    error?: string | null;
  };
  if (!response.ok || !payload.url) {
    throw new PlatformCheckoutError(payload.error || "checkout_failed", response.status);
  }

  return normalizeStripeBillingUrl(payload.url);
}

type NavigationWindow = Pick<Window, "location" | "matchMedia" | "open"> & {
  navigator: Navigator & { standalone?: boolean };
};

export function isInstalledPwa(target: NavigationWindow = window) {
  return (
    target.matchMedia("(display-mode: standalone)").matches ||
    target.matchMedia("(display-mode: fullscreen)").matches ||
    target.navigator.standalone === true
  );
}

/**
 * iOS and some Android PWA shells only allow a new external browsing context
 * while the original click is still active. Reserve it synchronously and fill
 * it after the authenticated checkout request completes. Normal browser tabs
 * keep using a same-tab navigation.
 */
export function prepareStripeBillingNavigation(target: NavigationWindow = window) {
  let externalWindow: Window | null = null;
  if (isInstalledPwa(target)) {
    try {
      externalWindow = target.open("about:blank", "_blank");
    } catch {
      externalWindow = null;
    }
  }

  return {
    complete(rawUrl: string) {
      const url = normalizeStripeBillingUrl(rawUrl);
      if (externalWindow && !externalWindow.closed) {
        try {
          externalWindow.location.replace(url);
          externalWindow.focus();
          return;
        } catch {
          try {
            externalWindow.close();
          } catch {
            // The same-tab fallback below remains available.
          }
        }
      }
      target.location.assign(url);
    },
    cancel() {
      if (!externalWindow || externalWindow.closed) return;
      try {
        externalWindow.close();
      } catch {
        // Closing a browser-owned external tab is best effort only.
      }
    },
  };
}
