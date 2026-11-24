import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = process.cwd();
const assets = resolve(root, "..", ".official-base-20261106", "dist", "client", "assets");
const cssName = readdirSync(assets).find((name) => /^styles-.*\.css$/.test(name));
assert.ok(cssName, "estilos da base oficial disponíveis");
const css = readFileSync(resolve(assets, cssName));
const server = await createServer({ root, configFile: false, appType: "mpa", optimizeDeps: { noDiscovery: true, include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"] }, resolve: { alias: { "@": resolve(root, "src") } }, server: { host: "127.0.0.1", port: 4195, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  mkdirSync("tests/evidence", { recursive: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/manual-whatsapp-style.css", (route) => route.fulfill({ status: 200, contentType: "text/css", body: css }));
    await page.goto("http://127.0.0.1:4195/tests/manual-appointment-whatsapp-fixture.html");
    await page.addStyleTag({ url: "/manual-whatsapp-style.css" });
    await page.getByRole("button", { name: "Abrir marcação" }).click({ timeout: 5000 }).catch(async (error) => {
      throw new Error(`${error.message}\nPage errors: ${errors.join(" | ")}\nBody: ${(await page.locator("body").innerText()).slice(0, 500)}`);
    });
    const action = page.getByTestId("manual-appointment-whatsapp");
    const href = await action.getAttribute("href");
    assert.ok(href);
    const url = new URL(href);
    assert.equal(url.origin, "https://wa.me");
    assert.equal(url.pathname, "/351912345678");
    assert.match(url.searchParams.get("text"), /Ana Silva.*Bellza Centro.*Manicure gel.*03.*dezembro.*2026.*10:00/s);
    assert.equal(await page.getByRole("button", { name: /Reenviar WhatsApp/ }).count(), 0);
    assert.equal(await action.getAttribute("target"), "_blank");
    assert.equal(await page.locator("aside").evaluate((node) => node.scrollWidth <= node.clientWidth), true);
    await page.screenshot({ path: `tests/evidence/manual-whatsapp-${viewport.width}.png` });
    let openedUrl = "";
    await page.context().route("https://wa.me/**", (route) => { openedUrl = route.request().url(); return route.abort(); });
    const popupPromise = page.waitForEvent("popup");
    await action.click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    assert.match(openedUrl, /^https:\/\/wa\.me\/351912345678\?text=/);
    await popup.close();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Remarcar" }).click();
    await page.getByRole("button", { name: "Abrir marcação" }).click();
    const changed = new URL(await action.getAttribute("href"));
    assert.match(changed.searchParams.get("text"), /04.*dezembro.*2026.*15:30/s);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Invalidar telefone" }).click();
    await page.getByRole("button", { name: "Abrir marcação" }).click();
    assert.equal(await action.getAttribute("href"), null);
    assert.equal(await action.isDisabled(), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Contacto manual WhatsApp: desktop/mobile, mensagem, remarcação, notificações desligadas e número inválido OK");
} finally {
  await browser?.close();
  await server.close();
}
