const CACHE_VERSION = "bellza-pwa-v20260729-push-receipts";
const APP_CACHE = `${CACHE_VERSION}-app`;
const IS_UPDATE = Boolean(self.registration.active);
const STATIC_ASSETS = [
  "/bellza-logo.png",
  "/pwa-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("bellza-pwa-") && key !== APP_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(async () => {
        await self.clients.claim();
        if (!IS_UPDATE) return;
        const clientList = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        await Promise.all(
          clientList.map((client) => {
            const clientUrl = new URL(client.url);
            if (clientUrl.origin !== self.location.origin || !("navigate" in client)) return undefined;
            return client.navigate(client.url).catch(() => undefined);
          }),
        );
      }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "BELLZA_STUDIO_VISUAL_VERSION") {
    event.waitUntil(clearRuntimeVisualCaches());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => Response.error()));
    return;
  }

  if (url.pathname.endsWith(".webmanifest") || url.pathname.includes("/api/public/studio-manifest/")) {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(() => Response.error()));
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(APP_CACHE).then((cache) => cache.put(request, clone)).catch(() => undefined);
            }
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = payload.title || "Bellza";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/pwa-icon.svg",
    badge: payload.badge || "/pwa-icon.svg",
    tag: payload.tag || payload.url || "bellza-notification",
    data: {
      url: payload.url || "/",
      ...payload.data,
    },
    renotify: Boolean(payload.renotify),
  };

  const receipt = {
    deliveryId: payload.data?.deliveryId,
    receiptToken: payload.data?.receiptToken,
  };
  const received = acknowledgePushReceipt(receipt, "received");
  const displayed = self.registration
    .showNotification(title, options)
    .then(() => acknowledgePushReceipt(receipt, "displayed"));

  event.waitUntil(Promise.allSettled([received, displayed]));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    renewChangedPushSubscription(event).then((subscription) =>
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
          client.postMessage({
            type: "BELLZA_PUSH_SUBSCRIPTION_CHANGED",
            subscription: subscription?.toJSON?.() || null,
          });
        }
      }),
    ),
  );
});

async function renewChangedPushSubscription(event) {
  if (event.newSubscription) return event.newSubscription;
  const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
  if (!applicationServerKey) return null;
  try {
    return await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  } catch (error) {
    console.error("[push] subscription_change_renewal_failed", error);
    return null;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  if (target.origin !== self.location.origin) target.href = self.location.origin;
  const targetUrl = target.href;
  const targetPath = target.pathname;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          const clientPath = clientUrl.pathname;
          if ("focus" in client && (client.url === targetUrl || clientPath === targetPath || clientUrl.origin === self.location.origin)) {
            if ("navigate" in client && client.url !== targetUrl) {
              return client.navigate(targetUrl).then((navigatedClient) => (navigatedClient || client).focus());
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
      }),
  );
});

function readPushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { title: "Bellza", body: event.data.text() };
  }
}

async function acknowledgePushReceipt(receipt, stage) {
  if (!receipt.deliveryId || !receipt.receiptToken) return;
  try {
    await fetch("/api/public/push/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryId: receipt.deliveryId,
        receiptToken: receipt.receiptToken,
        stage,
      }),
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    console.warn("[push] receipt_ack_failed", stage);
  }
}

async function clearRuntimeVisualCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("bellza-pwa-") && key !== APP_CACHE)
      .map((key) => caches.delete(key)),
  );
}
