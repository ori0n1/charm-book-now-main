import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  BELLZA_APP_ICON_192,
  BELLZA_APP_ICON_512,
  BELLZA_APP_ICON_SVG,
  BELLZA_APPLE_TOUCH_ICON,
  BELLZA_FAVICON,
  BELLZA_LOGO,
  BELLZA_SYMBOL,
} from "../src/lib/brand-assets";

const officialAssetHashes = {
  "bellza-logo.svg": "98c3067026a0c97b3a2335b005a5c10ff07395356f6927d659eb8ac86511120c",
  "bellza-logo-white.svg": "ff807b7418eaa36691fc70b66e97455f25471d0e6c4fd1d96f97509062fb3d45",
  "bellza-symbol.svg": "85d5e529d18a2eb343a627dd0ddb70c1a72de111df447540bd540edfdf2fb7f5",
  "bellza-symbol-dark.svg": "af7261d1dde57a127dd4eeb1f2d66645ae20702d7e248fd3de19d434aecd59b7",
  "bellza-symbol-white.svg": "54fbc5e47f931ddda1ef3218f6136dbfac207ac05b2bdd421bf8350568da0f42",
  "bellza-app-icon.svg": "e1c7191ca66732bde3ac9c6808495a310ac2e45310cc6880b81c693dd34cd5be",
  "bellza-app-icon-dark.svg": "c1a9c9cd1bae6f567ba987e48745232a489260b2b70afe04695984d1c81e4520",
  "bellza-favicon.svg": "e1c7191ca66732bde3ac9c6808495a310ac2e45310cc6880b81c693dd34cd5be",
} as const;

test("official identity SVGs remain byte-for-byte unchanged", async () => {
  for (const [name, expectedHash] of Object.entries(officialAssetHashes)) {
    const asset = await readFile(`public/${name}`);
    const hash = createHash("sha256").update(asset).digest("hex");
    expect(hash, name).toBe(expectedHash);
  }
});

test("legacy platform identity is no longer referenced or shipped", async () => {
  const sources = await Promise.all([
    readFile("src/components/bellza-logo.tsx", "utf8"),
    readFile("src/components/booking-experience.tsx", "utf8"),
    readFile("src/lib/blog.ts", "utf8"),
    readFile("src/lib/notification-dispatcher.server.ts", "utf8"),
    readFile("src/lib/public-client.functions.ts", "utf8"),
    readFile("src/lib/push-subscriptions.functions.ts", "utf8"),
    readFile("src/lib/staff-presence.functions.ts", "utf8"),
    readFile("src/lib/studio-follows.functions.ts", "utf8"),
    readFile("src/routes/__root.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.tsx", "utf8"),
    readFile("src/routes/api/public/studio-manifest.$slug.ts", "utf8"),
    readFile("src/routes/index.tsx", "utf8"),
    readFile("src/routes/s.$slug.tsx", "utf8"),
    readFile("public/manifest.webmanifest", "utf8"),
    readFile("public/sw.js", "utf8"),
  ]);
  const combined = sources.join("\n");

  for (const legacyAsset of ["bellza-logo.png", "bellza-logo-96.webp", "pwa-icon.svg"]) {
    expect(combined).not.toContain(legacyAsset);
    await expect(access(`public/${legacyAsset}`)).rejects.toThrow();
  }
});

test("landing and login render the official responsive wordmark", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const landingLogo = page.locator(`header img[src="${BELLZA_LOGO}"]`).first();
  await expect(landingLogo).toBeVisible();
  await expect(page.locator(`link[rel="icon"][href="${BELLZA_FAVICON}"]`).first()).toHaveAttribute(
    "type",
    "image/svg+xml",
  );
  await expect(
    page.locator(`link[rel="apple-touch-icon"][href="${BELLZA_APPLE_TOUCH_ICON}"]`).first(),
  ).toHaveAttribute("sizes", "180x180");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();

  await page.goto("/login");
  await expect(page.locator(`header img[src="${BELLZA_LOGO}"]`).first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test("public pages keep one light Bellza brand system even when the app theme is dark", async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem("bellza:theme", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ["/", "/login", "/blog", "/termos"]) {
    await page.goto(path);
    await expect(page.locator(".public-site-theme.public-landing-theme")).toBeVisible();
    await expect(page.locator(`header img[src="${BELLZA_LOGO}"]`)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
  }

  await page.goto("/pagina-que-nao-existe");
  await expect(page.locator(`img[src="${BELLZA_SYMBOL}"]`)).toBeVisible();
});

test("page-level loading states use the shared official Bellza symbol", async () => {
  const loadingSources = await Promise.all([
    readFile("src/components/booking-experience.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.tsx", "utf8"),
    readFile("src/routes/auth.callback.tsx", "utf8"),
    readFile("src/routes/convite-equipa.$token.tsx", "utf8"),
    readFile("src/routes/marcacao.$token.tsx", "utf8"),
    readFile("src/routes/s.$slug.tsx", "utf8"),
  ]);

  for (const source of loadingSources) expect(source).toContain("<BrandLoadingState");
});

test("manifest, service worker and installable assets use the new app icon", async ({
  request,
}) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();

  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: BELLZA_APP_ICON_SVG, purpose: "any maskable" }),
      expect.objectContaining({ src: BELLZA_APP_ICON_192, sizes: "192x192" }),
      expect.objectContaining({ src: BELLZA_APP_ICON_512, sizes: "512x512" }),
    ]),
  );

  for (const asset of [
    "/bellza-logo.svg",
    "/bellza-logo-white.svg",
    "/bellza-symbol.svg",
    "/bellza-symbol-dark.svg",
    "/bellza-symbol-white.svg",
    "/bellza-app-icon.svg",
    "/bellza-app-icon-dark.svg",
    "/bellza-app-icon-192.png",
    "/bellza-app-icon-512.png",
    "/bellza-apple-touch-icon.png",
    "/bellza-favicon.svg",
  ]) {
    const response = await request.get(asset);
    expect(response.ok(), asset).toBeTruthy();
  }

  const serviceWorker = await (await request.get("/sw.js")).text();
  expect(serviceWorker).toContain('const BRAND_ASSET_VERSION = "20260911-push-pwa-v2"');
  expect(serviceWorker).toContain("/bellza-app-icon-192.png?v=${BRAND_ASSET_VERSION}");
  expect(serviceWorker).toContain("/bellza-symbol-dark.svg?v=${BRAND_ASSET_VERSION}");
});
