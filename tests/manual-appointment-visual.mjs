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
  assert.match(await card.getAttribute("aria-label"), /lembrete manual de WhatsApp pendente nos detalhes/);
  assert.match(await card.textContent(), /Lembrete pendente/);
  await card.click();
  assert.match(await page.locator("body").innerText(), /Detalhes da marcação/i);
  const messageAction = page.getByTestId("manual-appointment-whatsapp");
  assert.equal(await messageAction.textContent(), "Enviar mensagem");
  const phoneBox = await page.getByText("+351912345678").boundingBox();
  const messageBox = await messageAction.boundingBox();
  assert.ok(phoneBox && messageBox && messageBox.y >= phoneBox.y + phoneBox.height, "compact action must sit below the phone");
  await messageAction.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "TEXTAREA", "the keyboard should stay closed when the dialog opens");
  const titleBox = await dialog.getByText("Mensagem para Jaqueline de Almeida Santos").boundingBox();
  const closeBox = await dialog.getByRole("button", { name: "Close" }).boundingBox();
  assert.ok(titleBox && closeBox && titleBox.x + titleBox.width <= closeBox.x, "close button must not overlap the title");
  const disabledAction = dialog.getByRole("button", { name: "Abrir no WhatsApp do estúdio" });
  const disabledBox = await disabledAction.boundingBox();
  const detailsBox = await dialog.getByRole("button", { name: "Ver detalhes da marcação" }).boundingBox();
  assert.ok(disabledBox && detailsBox && disabledBox.y > titleBox.y + titleBox.height && detailsBox.y > titleBox.y + titleBox.height, "actions must stay in the footer");
  assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), true, "mobile dialog must not overflow horizontally");
  assert.ok(closeBox && await dialog.getByRole("button", { name: "Close" }).isVisible(), "dialog close must remain visible");
  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopTitle = await dialog.getByText("Mensagem para Jaqueline de Almeida Santos").boundingBox();
  const desktopAction = await disabledAction.boundingBox();
  assert.ok(desktopTitle && desktopAction && desktopAction.y > desktopTitle.y + desktopTitle.height, "desktop action must stay in the footer");
  assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), true, "desktop dialog must not overflow horizontally");
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("button", { name: "Ver detalhes da marcação" }).click();
  assert.match(await page.locator("body").innerText(), /Detalhes da marcação/i);
  await page.getByTestId("manual-appointment-whatsapp").click();
  await dialog.getByRole("textbox", { name: "Mensagem" }).fill("Texto editado para Jaqueline");
  await dialog.getByRole("checkbox").check();
  const link = dialog.getByRole("link", { name: "Abrir no WhatsApp do estúdio" });
  assert.match(await link.getAttribute("href"), /Texto%20editado%20para%20Jaqueline/);
  await page.route("https://wa.me/**", (route) => route.abort());
  await link.click();
  assert.equal(await page.getByTestId("sent-state").textContent(), "Enviada manualmente");
  assert.doesNotMatch(await card.getAttribute("aria-label"), /lembrete manual de WhatsApp pendente/);
  await card.click();
  assert.match(await page.locator("body").innerText(), /Lembrete enviado manualmente/);
  assert.equal(await page.getByText("Lembrete enviado", { exact: true }).count(), 1);
  assert.equal(await messageAction.textContent(), "Reenviar mensagem");
  const sentBox = await page.getByText("Lembrete enviado", { exact: true }).boundingBox();
  const resendBox = await messageAction.boundingBox();
  assert.ok(sentBox && resendBox && Math.abs(sentBox.y - resendBox.y) < 8, "sent status and resend action must align");
  assert.equal(await page.getByText("Lembrete pendente", { exact: true }).count(), 0);
  await messageAction.click();
  assert.match(await dialog.getByRole("textbox", { name: "Mensagem" }).inputValue(), /Brushing.*09:00/);
  await dialog.getByRole("button", { name: "Ver detalhes da marcação" }).click();
  assert.equal(await messageAction.textContent(), "Reenviar mensagem");
  await page.getByRole("button", { name: /Fechar|Close/ }).first().click();
  await page.getByTestId("mode-toggle").click();
  assert.doesNotMatch(await card.getAttribute("aria-label"), /lembrete manual de WhatsApp pendente/);
  await card.click();
  assert.match(await page.locator("body").innerText(), /Detalhes da marcação/i);
  assert.doesNotMatch(await page.getByTestId("manual-appointment-whatsapp").textContent(), /Enviar mensagem/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mobile: "390x844", detailsFirst: true, closeClearOfTitle: true, keyboardClosedOnOpen: true, editedMessage: true, manualStatus: true, resendAvailable: true, automaticModeWithoutManualAction: true }));
} finally {
  await browser?.close();
}
