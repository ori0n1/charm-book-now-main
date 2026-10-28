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

export type PushActivationCode =
  | NotificationPermission
  | "unsupported"
  | "pwa_install_required"
  | "missing_vapid_key"
  | "invalid_vapid_key"
  | "insecure_context"
  | "push_unsupported"
  | "service_worker_failed"
  | "service_worker_timeout"
  | "subscription_failed"
  | "invalid_subscription";

export type PushSubscriptionResult = {
  permission: PushActivationCode;
  subscription?: PushSubscriptionPayload;
  alreadySubscribed?: boolean;
  errorCode?: string;
};

const SERVICE_WORKER_READY_TIMEOUT_MS = 12_000;

export async function requestPushSubscription(
  options: PushSubscriptionOptions = {},
): Promise<PushSubscriptionResult> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { permission: "unsupported" };
  }
  if (!window.isSecureContext) return { permission: "insecure_context" };
  if (isIosDevice() && !isStandalonePwa()) {
    return { permission: "pwa_install_required" };
  }
  if (!("Notification" in window)) return { permission: "unsupported" };
  if (!("PushManager" in window)) return { permission: "push_unsupported" };

  const vapidPublicKey = cleanBase64Url(
    import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined,
  );
  if (!vapidPublicKey) return { permission: "missing_vapid_key" };
  if (!isValidVapidPublicKey(vapidPublicKey)) {
    logPushBrowserFailure("validate_vapid_key", "invalid_vapid_key");
    return { permission: "invalid_vapid_key" };
  }

  // Keep the permission request directly in the user-initiated call stack. This
  // matters on Safari/iOS, where awaiting another operation first can lose gesture activation.
  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

  if (permission !== "granted") return { permission };

  let registration: ServiceWorkerRegistration;
  try {
    registration = await getReadyServiceWorkerRegistration();
  } catch (error) {
    const errorCode = browserErrorCode(error);
    logPushBrowserFailure("service_worker_ready", errorCode);
    return {
      permission:
        errorCode === "service_worker_ready_timeout"
          ? "service_worker_timeout"
          : "service_worker_failed",
      errorCode,
    };
  }

  try {
    const existing = await registration.pushManager.getSubscription();
    let subscription = existing;
    if (subscription && shouldRenewSubscription(subscription, options, vapidPublicKey)) {
      await subscription.unsubscribe().catch(() => undefined);
      subscription = null;
    }
    const alreadySubscribed = Boolean(subscription);
    if (!subscription) {
      subscription = await subscribe(registration, vapidPublicKey);
    }

    const normalized = normalizeSubscription(subscription);
    if (!isValidSubscription(normalized)) {
      logPushBrowserFailure("normalize_subscription", "subscription_keys_missing");
      return { permission: "invalid_subscription", errorCode: "subscription_keys_missing" };
    }

    return {
      permission,
      subscription: normalized,
      alreadySubscribed,
    };
  } catch (error) {
    const errorCode = browserErrorCode(error);
    logPushBrowserFailure("push_manager_subscribe", errorCode);
    return { permission: "subscription_failed", errorCode };
  }
}

export async function getCurrentPushSubscription() {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return null;
  }

  const registration = await getReadyServiceWorkerRegistration();
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? normalizeSubscription(subscription) : null;
}

export async function unsubscribeCurrentPushSubscription() {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return false;
  }

  const registration = await getReadyServiceWorkerRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  return subscription.unsubscribe();
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

export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function pushActivationMessage(code: PushActivationCode) {
  switch (code) {
    case "granted":
      return "Notificações ativadas neste dispositivo.";
    case "denied":
      return "Notificações bloqueadas nas definições do dispositivo. Autorize a Bellza e tente novamente.";
    case "default":
      return "A permissão não foi concluída. Toque em ativar e confirme o pedido do dispositivo.";
    case "pwa_install_required":
      return "No iPhone ou iPad, adicione a Bellza ao ecrã principal e abra o app instalado para ativar notificações.";
    case "unsupported":
    case "push_unsupported":
      return "Este navegador não suporta notificações push neste modo.";
    case "insecure_context":
      return "As notificações exigem HTTPS. Abra pelo domínio oficial da Bellza.";
    case "service_worker_timeout":
      return "O app ainda está a concluir a atualização. Feche, abra novamente e toque em Reativar notificações.";
    case "service_worker_failed":
      return "O componente de notificações do app não iniciou. Verifique a ligação e tente novamente.";
    case "subscription_failed":
    case "invalid_subscription":
      return "O dispositivo não conseguiu criar uma subscrição válida. Verifique a ligação e tente novamente.";
    case "missing_vapid_key":
    case "invalid_vapid_key":
      return "A configuração de notificações está temporariamente indisponível.";
  }
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

async function getReadyServiceWorkerRegistration() {
  const current = await navigator.serviceWorker.getRegistration("/");
  const registration =
    current ??
    (await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }));

  if (registration.active) return registration;

  return withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_READY_TIMEOUT_MS,
    "service_worker_ready_timeout",
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(code)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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

function isValidSubscription(subscription: PushSubscriptionPayload) {
  return Boolean(
    subscription.endpoint &&
      /^https:\/\//i.test(subscription.endpoint) &&
      subscription.keys.p256dh &&
      subscription.keys.auth,
  );
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

function isValidVapidPublicKey(value: string) {
  try {
    const bytes = urlBase64ToUint8Array(value);
    return bytes.length === 65 && bytes[0] === 4;
  } catch {
    return false;
  }
}

function cleanBase64Url(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/=+$/g, "");
}

function browserErrorCode(error: unknown) {
  const value =
    error instanceof DOMException
      ? error.name || error.message
      : error instanceof Error
        ? error.message || error.name
        : String(error);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown_error";
}

function logPushBrowserFailure(stage: string, code: string) {
  console.warn("[push] browser_activation_failed", {
    stage,
    code,
    platform: isIosDevice() ? "ios" : navigator.platform || "unknown",
    standalone: isStandalonePwa(),
  });
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
