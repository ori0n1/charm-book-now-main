import { expect, test } from "@playwright/test";
import { CRITICAL_PAINT_CSS, PWA_STARTUP_SCRIPT } from "../src/lib/pwa-startup";

test("PWA update activates and refreshes installed clients once", async ({ page }) => {
  const swResponse = await page.request.get("/sw.js");
  expect(swResponse.ok()).toBeTruthy();
  const sw = await swResponse.text();

  expect(sw).toContain("self.skipWaiting()");
  expect(sw).toContain("const IS_UPDATE = Boolean(self.registration.active)");
  expect(sw).toContain("if (!IS_UPDATE) return");
  expect(sw).toContain("client.navigate(client.url)");
  expect(sw).not.toContain("BELLZA_SW_SKIP_WAITING");
  expect(sw).not.toContain("location.reload");
  expect(sw).toContain("pushsubscriptionchange");
  expect(sw).toContain("notificationclick");

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();

  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("/");
  expect(manifest.start_url).toBe("/admin/agenda");
  expect(manifest.start_url).not.toContain("pwa_v=");
});

test("PWA update checks preserve browser storage across reloads", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("bellza:pwa-update-test", "session-kept");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("bellza:pwa-update-test")))
    .toBe("session-kept");
});

test("legacy installed PWA launches resolve to Agenda before React", async ({ page }) => {
  await page.route("**/admin", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><script>${PWA_STARTUP_SCRIPT}</script></head><body>Início</body></html>`,
    }),
  );
  await page.route("**/admin/agenda", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html><body>Agenda</body></html>" }),
  );
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) =>
        query === "(display-mode: standalone)"
          ? {
              matches: true,
              media: query,
              onchange: null,
              addListener() {},
              removeListener() {},
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent: () => false,
            }
          : nativeMatchMedia(query),
    });
  });

  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/admin/agenda");

  expect(PWA_STARTUP_SCRIPT).toContain('p==="/admin"');
  expect(PWA_STARTUP_SCRIPT).toContain('location.replace("/admin/agenda"');
});

test("initial document includes Bellza background before app CSS loads", async ({ page }) => {
  const response = await page.request.get("/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();

  expect(CRITICAL_PAINT_CSS).toContain("background:#f7f3ed");
  expect(html.indexOf(CRITICAL_PAINT_CSS)).toBeGreaterThan(-1);
  expect(html.indexOf(CRITICAL_PAINT_CSS)).toBeLessThan(html.indexOf("</head>"));
  expect(html.indexOf(CRITICAL_PAINT_CSS)).toBeLessThan(html.indexOf("<body"));
});
