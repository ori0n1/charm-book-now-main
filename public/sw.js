const CACHE_VERSION = "bellza-pwa-v20260707-safe-update";
const APP_CACHE = `${CACHE_VERSION}-app`;
const STATIC_ASSETS = [
  "/bellza-logo.png",
  "/pwa-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined),
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
      .then(() => self.clients.claim()),
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

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({ type: "BELLZA_PUSH_SUBSCRIPTION_CHANGED" });
      }
    }),
  );
});

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

async function clearRuntimeVisualCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("bellza-pwa-") && key !== APP_CACHE)
      .map((key) => caches.delete(key)),
  );
}
