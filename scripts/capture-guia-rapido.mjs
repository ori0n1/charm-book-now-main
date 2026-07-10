import { chromium, devices } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const origin = process.env.BELLZA_CAPTURE_ORIGIN ?? "http://127.0.0.1:4178";
const email = process.env.BELLZA_CAPTURE_EMAIL;
const password = process.env.BELLZA_CAPTURE_PASSWORD;
const outputDir = join(process.cwd(), "public", "docs", "guia-bellza", "prints");

const desktopViewport = { width: 1440, height: 960 };
const mobileDevice = devices["iPhone 13"];

const captures = [
  { path: "/admin", file: "inicio-desktop.png", waitFor: "Início" },
  { path: "/admin/marca", file: "marca-desktop.png", waitFor: "Marca" },
  { path: "/admin/servicos", file: "servicos-desktop.png", waitFor: "Serviços" },
  { path: "/admin/equipa", file: "equipa-desktop.png", waitFor: "Profissionais" },
  { path: "/admin/horarios", file: "horarios-desktop.png", waitFor: "Horários" },
  { path: "/admin/agenda", file: "agenda-desktop.png", waitFor: "Agenda" },
  { path: "/admin/balcao", file: "balcao-desktop.png", waitFor: "Balcão" },
  { path: "/admin/clientes", file: "clientes-desktop.png", waitFor: "Clientes" },
  { path: "/s/bellza", file: "publica-desktop.png", waitFor: "Bellza", public: true },
];

if (!email || !password) {
  throw new Error(
    "Defina BELLZA_CAPTURE_EMAIL e BELLZA_CAPTURE_PASSWORD para capturar prints reais do Guia Rápido.",
  );
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: desktopViewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await login(page);

  for (const capture of captures) {
    await capturePage(page, capture, desktopViewport);
  }

  await context.close();

  const mobileContext = await browser.newContext(mobileDevice);
  const mobilePage = await mobileContext.newPage();
  await login(mobilePage);
  await capturePage(mobilePage, { path: "/admin", file: "inicio-mobile.png", waitFor: "Início" }, {
    width: mobileDevice.viewport.width,
    height: mobileDevice.viewport.height,
  });
  await mobileContext.close();
} finally {
  await browser.close();
}

async function login(page) {
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  await page.getByLabel("Email ou WhatsApp").waitFor({ state: "visible", timeout: 30000 });
  await acceptCookiesIfVisible(page);
  await page.waitForTimeout(2000);

  if (page.url().includes("/admin")) return;

  await page.getByLabel("Email ou WhatsApp").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/admin(\/.*)?$/, { timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
}

async function acceptCookiesIfVisible(page) {
  const acceptButton = page.getByRole("button", { name: "Aceitar", exact: true });
  if (await acceptButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await acceptButton.click();
  }
}

async function capturePage(page, capture, viewport) {
  await page.goto(`${origin}${capture.path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  if (capture.public) {
    await page.getByText(capture.waitFor, { exact: false }).first().waitFor({ state: "visible", timeout: 30000 });
  } else {
    try {
      await page.locator(".admin-content").waitFor({ state: "visible", timeout: 30000 });
    } catch (error) {
      await page.screenshot({ path: join(outputDir, `debug-${capture.file}`), fullPage: true });
      const text = await page.locator("body").innerText().catch(() => "");
      console.error(`[guia] failed ${capture.path} at ${page.url()}`);
      console.error(text.slice(0, 1200));
      throw error;
    }
  }

  if (!capture.public) {
    await page.locator("aside, nav, header, [data-tour]").evaluateAll((elements) => {
      for (const element of elements) {
        element.setAttribute("data-guide-hidden", "true");
      }
    });
    await page.addStyleTag({
      content: `
        [data-guide-hidden="true"] { display: none !important; }
        .fixed:not([data-keep-guide-fixed]) { display: none !important; }
        main { margin: 0 !important; }
        .admin-content { max-width: 1180px !important; margin-inline: auto !important; padding: 24px !important; }
        body { background: var(--color-background) !important; }
      `,
    });
    await page.locator(".admin-content > *").evaluateAll((elements) => {
      for (const element of elements) {
        const text = (element.textContent ?? "").toLocaleLowerCase("pt-PT");
        if (text.includes("cancelamento agendado") || text.includes("premium ativo") || text.includes("ação necessária")) {
          element.setAttribute("data-guide-hidden", "true");
        }
      }
    });
  }

  const clip = capture.public
    ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
    : await page.locator(".admin-content").evaluate((element, fallback) => {
        const rect = element.getBoundingClientRect();
        const height = Math.min(fallback.height, Math.ceil(rect.height + 48));
        return {
          x: 0,
          y: Math.max(0, Math.floor(rect.top - 24)),
          width: fallback.width,
          height,
        };
      }, viewport);

  await page.screenshot({
    path: join(outputDir, capture.file),
    clip,
  });
  console.log(`[guia] captured ${capture.file}`);
}
