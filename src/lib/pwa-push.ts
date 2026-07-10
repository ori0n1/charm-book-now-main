export type PushSubscriptionPayload = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type PushSubscriptionOptions = {
  forceRenew?: boolean;
};

export async function requestPushSubscription(options: PushSubscriptionOptions = {}): Promise<{
  permission:
    | NotificationPermission
    | "unsupported"
    | "missing_vapid_key"
    | "insecure_context"
    | "push_unsupported";
  subscription?: PushSubscriptionPayload;
}> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { permission: "unsupported" };
  }
  if (!window.isSecureContext) return { permission: "insecure_context" };
  if (!("PushManager" in window)) return { permission: "push_unsupported" };

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPublicKey) return { permission: "missing_vapid_key" };

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

  if (permission !== "granted") return { permission };

  if (!navigator.serviceWorker.controller) {
    await navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  let subscription = existing;
  if (subscription && shouldRenewSubscription(subscription, options, vapidPublicKey)) {
    await subscription.unsubscribe().catch(() => undefined);
    subscription = null;
  }
  if (!subscription) {
    subscription = await subscribe(registration, vapidPublicKey);
  }

  return {
    permission,
    subscription: normalizeSubscription(subscription),
  };
}

function shouldRenewSubscription(
  subscription: PushSubscription,
  options: PushSubscriptionOptions,
  vapidPublicKey: string,
) {
  if (options.forceRenew) return true;
  if (subscriptionUsesDifferentApplicationServerKey(subscription, vapidPublicKey)) return true;
  const expirationTime = subscription.expirationTime;
  if (!expirationTime) return false;
  return expirationTime - Date.now() < 7 * 24 * 60 * 60 * 1000;
}

function subscriptionUsesDifferentApplicationServerKey(
  subscription: PushSubscription,
  vapidPublicKey: string,
) {
  const options = (subscription as PushSubscription & {
    options?: { applicationServerKey?: ArrayBuffer | null };
  }).options;
  const key = options?.applicationServerKey;
  if (!key) return false;
  return bytesToBase64Url(new Uint8Array(key)) !== cleanBase64Url(vapidPublicKey);
}

export function canAskForWebPush() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function shouldRefreshStoredPushSubscription(scopeKey: string, ttlMs = 24 * 60 * 60 * 1000) {
  if (typeof window === "undefined") return false;
  const key = `bellza-push-refresh:${scopeKey}`;
  const last = Number(window.localStorage.getItem(key) ?? "0");
  if (Number.isFinite(last) && Date.now() - last < ttlMs) return false;
  window.localStorage.setItem(key, String(Date.now()));
  return true;
}

async function subscribe(registration: ServiceWorkerRegistration, vapidPublicKey: string) {
  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  } catch (error) {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe().catch(() => undefined);
    }
    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
}

function normalizeSubscription(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON() as {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };

  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
  };
}

function urlBase64ToUint8Array(value: string) {
  const clean = cleanBase64Url(value);
  const padding = "=".repeat((4 - (clean.length % 4)) % 4);
  const base64 = `${clean}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function cleanBase64Url(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/=+$/g, "");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
