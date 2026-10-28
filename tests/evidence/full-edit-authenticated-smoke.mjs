import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { qaProductionIdentity } from "../../../financial-privacy-20261025-candidate/tests/qa-production-secret.mjs";

// Explicit QA-only smoke. Its appointment and client belong to the synthetic QA studio.
const studioId = "e2663064-7774-41c5-95cb-e5e6afc4fab4";
const appointmentId = "045a9318-3abd-4cc3-ae5c-ae32bb270541";
const mobile = process.argv.includes("--mobile");
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const identity = await qaProductionIdentity("owner");
const config = JSON.parse(await readFile(new URL("../../wrangler.production.jsonc", import.meta.url), "utf8"));
const vars = config.env.production.vars;
const client = createClient(vars.VITE_SUPABASE_URL, vars.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const browser = await chromium.launch({ headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport });

async function state() {
  const result = await client.from("appointments").select("id,status")
    .eq("id", appointmentId).eq("studio_id", studioId).single();
  if (result.error) throw result.error;
  return result.data.status;
}
async function waitState(expected) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await state() === expected) return;
    await delay(300);
  }
  throw new Error(`QA appointment did not reach ${expected}`);
}
async function openViaBell() {
  if (await page.getByText("Detalhes da marcação", { exact: true }).count()) {
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Abrir notificações", exact: true }).click();
  await page.getByRole("button", { name: /Próximo atendimento/ }).first().click();
  await page.waitForURL((url) => url.pathname === "/admin/agenda", { timeout: 30000 });
  await page.getByText("Detalhes da marcação", { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(new URL(page.url()).pathname, "/admin/agenda");
}
async function openEditor(label = "Editar reserva") {
  await page.getByRole("button", { name: label, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Editar marcação" });
  await editor.waitFor({ timeout: 30000 });
  assert.equal(await editor.count(), 1, "one tap opens exactly one editor");
  await editor.getByRole("button", { name: "Fechar Editar marcação" }).click();
}

let testError;
let clientAuthenticated = false;
try {
  await page.goto("https://bellza.pt/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="identifier"]').fill(identity.email);
  await page.locator('input[name="password"]').fill(identity.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });
  const cookies = page.getByRole("button", { name: "Aceitar", exact: true });
  if (await cookies.count()) await cookies.click();
  await page.getByText("Guia inicial", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Pular", exact: true }).click();

  const auth = await client.auth.signInWithPassword({ email: identity.email, password: identity.password });
  assert.ifError(auth.error);
  assert.equal(auth.data.user.id, identity.id);
  clientAuthenticated = true;
  assert.equal(await state(), "confirmed");
  const cashBefore = await client.from("cash_register_movements").select("id")
    .eq("appointment_id", appointmentId);
  const paidBefore = await client.from("payment_intents").select("id,status")
    .eq("appointment_id", appointmentId);
  assert.ifError(cashBefore.error); assert.ifError(paidBefore.error);
  assert.equal(cashBefore.data.length, 0);
  assert.equal(paidBefore.data.filter((item) => item.status === "succeeded").length, 0);

  await openViaBell();
  await openEditor();
  await openViaBell();
  await page.getByRole("button", { name: "Faltou", exact: true }).click();
  await waitState("no_show");
  await page.getByRole("button", { name: "Faltou", exact: true, pressed: true }).waitFor();
  await openEditor();

  await openViaBell();
  await page.getByRole("button", { name: "Compareceu", exact: true }).click();
  await waitState("completed");
  await page.getByRole("button", { name: "Compareceu", exact: true, pressed: true }).waitFor();
  await openEditor();

  await openViaBell();
  await page.getByRole("button", { name: "Compareceu", exact: true, pressed: true }).click();
  await waitState("confirmed");

  await openViaBell();
  await page.getByRole("button", { name: "Cancelar marcação", exact: true }).click();
  await page.getByTestId("cancel-confirmation").getByRole("button", { name: "Confirmar cancelamento" }).click();
  await waitState("cancelled");
  await page.keyboard.press("Escape");
  await openViaBell();
  await openEditor("Reabrir e editar");
  await waitState("confirmed");

  const cashAfter = await client.from("cash_register_movements").select("id")
    .eq("appointment_id", appointmentId);
  const paidAfter = await client.from("payment_intents").select("id,status")
    .eq("appointment_id", appointmentId);
  assert.ifError(cashAfter.error); assert.ifError(paidAfter.error);
  assert.deepEqual(cashAfter.data.map((row) => row.id), cashBefore.data.map((row) => row.id));
  assert.deepEqual(paidAfter.data.map((row) => row.id), paidBefore.data.map((row) => row.id));
  console.log(`authenticated synthetic QA ${mobile ? "mobile" : "desktop"}: Faltou, Compareceu, undo, bell reopen, one-click editor OK`);
} catch (error) {
  testError = error;
  console.error(JSON.stringify({ phase: "smoke-failed", route: new URL(page.url()).pathname,
    alerts: await page.locator('[role="alert"]').allTextContents(),
    status: clientAuthenticated ? await state() : "not-queried" }));
} finally {
  try { if (clientAuthenticated) {
    const current = await state();
    if (current !== "confirmed") {
      await page.keyboard.press("Escape");
      await openViaBell();
      if (current === "cancelled") await openEditor("Reabrir e editar");
      else await page.getByRole("button", { name: current === "no_show" ? "Faltou" : "Compareceu", exact: true, pressed: true }).click();
      await waitState("confirmed");
    }
  }
  } catch (recoveryError) {
    console.error("QA synthetic state recovery failed:", recoveryError);
    testError ??= recoveryError;
  }
  if (clientAuthenticated) await client.auth.signOut();
  await browser.close();
}
if (testError) throw testError;
