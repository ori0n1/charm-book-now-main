import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { qaProductionIdentity } from "../../financial-privacy-20261025-candidate/tests/qa-production-secret.mjs";

const base = "https://bellza.pt";
const api = "https://pwmdzpvnatrvfpgcvnzg.supabase.co";
const cases = [
  { state: "Pendente", paid: "0,00", remaining: "30,00" },
  { state: "Pago", paid: "20,00", remaining: null },
];

const identity = await qaProductionIdentity("owner");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: "block", permissions: [] });
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return origin === base || origin === api ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("[agenda]")) {
      console.log(JSON.stringify({ agendaError: message.text().slice(0, 500) }));
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) console.log(JSON.stringify({ httpError: response.status(), path: new URL(response.url()).pathname }));
  });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="identifier"]').fill(identity.email);
  await page.locator('input[name="password"]').fill(identity.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/admin", { timeout: 30000 });
  await page.waitForTimeout(2000);
  const cookies = page.getByRole("button", { name: "Rejeitar", exact: true });
  await cookies.waitFor({ state: "visible", timeout: 15000 });
  await cookies.click();
  await cookies.waitFor({ state: "hidden", timeout: 5000 });
  const guide = page.getByRole("button", { name: "Pular", exact: true });
  await guide.waitFor({ state: "visible", timeout: 8000 });
  for (let attempt = 0; attempt < 5 && await guide.isVisible().catch(() => false); attempt++) {
    await guide.click();
    await page.waitForTimeout(700);
  }
  await guide.waitFor({ state: "hidden", timeout: 3000 });
  const installPrompt = page.getByRole("button", { name: "Lembrar depois", exact: true });
  if (await installPrompt.isVisible().catch(() => false)) await installPrompt.click();
  await page.waitForTimeout(1000);

  await page.goto(`${base}/admin/agenda`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Agenda", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("button", { name: "Pesquisa e filtros" }).click();
  await page.getByPlaceholder("Pesquisar cliente, telefone ou profissional...").fill("Cliente sintético QA");
  const results = page.getByTestId("agenda-filter-results").locator("button");
  await results.first().waitFor({ state: "visible", timeout: 30000 }).catch(async (error) => {
    console.log(JSON.stringify({ url: page.url(), excerpt: (await page.locator("body").innerText()).slice(-1800) }));
    throw error;
  });
  assert.equal(await results.count(), 2, "expected exactly the two synthetic QA appointments");
  const observed = [];
  for (let index = 0; index < 2; index++) {
    await results.nth(index).click();
    const drawer = page.locator("aside").filter({ hasText: "Detalhes da marcação" });
    await drawer.waitFor({ state: "visible", timeout: 10000 }).catch(async (error) => {
      console.log(JSON.stringify({ url: page.url(), excerpt: (await page.locator("body").innerText()).slice(-1800) }));
      throw error;
    });
    const details = await drawer.innerText();
    assert.ok(details.includes("Cliente sintético QA"));
    const item = cases.find((candidate) => details.includes(candidate.state));
    assert.ok(item, "payment state missing from appointment drawer");
    assert.ok(details.includes("PAGAMENTO") && details.includes(item.paid));
    if (item.remaining) assert.ok(details.includes("RESTANTE") && details.includes(item.remaining));
    if (item.state === "Pago") assert.ok(details.includes("MÉTODO DE PAGAMENTO") && details.includes("Dinheiro"));
    observed.push(item.state);
    await page.getByRole("button", { name: "Fechar detalhes" }).click();
  }
  assert.deepEqual(observed.sort(), cases.map((item) => item.state).sort());
  console.log(JSON.stringify({ checked: observed, syntheticOnly: true }));
  await context.close();
} finally {
  await browser.close();
}
