import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = process.cwd();
const bundle = await build({
  entryPoints: [resolve(root, "tests/manual-appointment-visual-fixture.tsx")],
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  alias: { "@": resolve(root, "src") },
});
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  const css = readdirSync("dist/client/assets").find((name) => name.startsWith("styles-") && name.endsWith(".css"));
  assert.ok(css, "production CSS must exist");
  await page.addStyleTag({ content: readFileSync(resolve(root, "dist/client/assets", css), "utf8") });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const card = page.locator('[data-timeline-entry="appointment"]');
  await card.waitFor();
  assert.match(await card.getAttribute("aria-label"), /mensagem manual de WhatsApp pendente/);
  await card.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const titleBox = await dialog.getByText("Mensagem para Jaqueline de Almeida Santos").boundingBox();
  const closeBox = await dialog.getByRole("button", { name: "Close" }).boundingBox();
  assert.ok(titleBox && closeBox && titleBox.x + titleBox.width <= closeBox.x, "close button must not overlap the title");
  await dialog.getByRole("button", { name: "Ver detalhes da marcação" }).click();
  assert.equal(await page.getByTestId("appointment-details").textContent(), "Detalhes do agendamento");
  await card.click();
  await dialog.getByRole("textbox", { name: "Mensagem" }).fill("Texto editado para Jaqueline");
  await dialog.getByRole("checkbox").check();
  const link = dialog.getByRole("link", { name: "Abrir no WhatsApp do estúdio" });
  assert.match(await link.getAttribute("href"), /Texto%20editado%20para%20Jaqueline/);
  await page.route("https://wa.me/**", (route) => route.abort());
  await link.click();
  assert.equal(await page.getByTestId("sent-state").textContent(), "Enviada manualmente");
  assert.doesNotMatch(await card.getAttribute("aria-label"), /mensagem manual de WhatsApp pendente/);
  await page.getByTestId("mode-toggle").click();
  assert.doesNotMatch(await card.getAttribute("aria-label"), /mensagem manual de WhatsApp pendente/);
  await card.click();
  assert.equal(await page.getByTestId("appointment-details").textContent(), "Detalhes do agendamento");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mobile: "390x844", closeClearOfTitle: true, editedMessage: true, manualStatus: true, automaticModeWithoutBubble: true }));
} finally {
  await browser?.close();
}
