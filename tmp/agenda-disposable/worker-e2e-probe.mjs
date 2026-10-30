import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const output = execFileSync("supabase", ["status", "--workdir", "tmp/agenda-disposable", "-o", "json"], { encoding: "utf8" });
const local = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
assert.equal(local.API_URL, "http://127.0.0.1:57921");
const role = process.argv[2] ?? "studio_owner";
assert.ok(["studio_owner", "manager", "staff", "desk_staff"].includes(role));
process.env.VITE_SUPABASE_URL = local.API_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.PUBLISHABLE_KEY;
process.env.SUPABASE_URL = local.API_URL;
process.env.SUPABASE_PUBLISHABLE_KEY = local.PUBLISHABLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY;
const sb = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `agenda-${role}-${crypto.randomUUID()}@synthetic.invalid`;
const password = `Agenda-${crypto.randomUUID()}!`;
const { data: created, error: createError } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
if (createError || !created.user) throw createError ?? new Error("create_user_failed");
const { error: roleError } = await sb.from("user_roles").insert({ user_id: created.user.id,
  studio_id: "11111111-1111-4111-8111-111111111111", role });
if (roleError) throw roleError;
if (role === "staff" || role === "desk_staff") {
  const staffId = role === "staff" ? "33333333-3333-4333-8333-000000000001" : "33333333-3333-4333-8333-000000000003";
  const { error: staffError } = await sb.from("staff").update({ user_id: created.user.id }).eq("id", staffId);
  if (staffError) throw staffError;
}
const actor = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: loginError } = await actor.auth.signInWithPassword({ email, password });
if (loginError) throw loginError;
const syntheticStart = new Date(Date.UTC(2030, 9, 30, 13, 30) + 7 * (1 + Math.floor(Math.random() * 1000)) * 86400000).toISOString();
const { data: booking, error: bookingError } = await actor.rpc("create_manual_multi_professional_appointment", {
  p_studio_id: "11111111-1111-4111-8111-111111111111",
  p_assignments: [{ serviceId: "44444444-4444-4444-8444-000000000001", staffId: "33333333-3333-4333-8333-000000000001" }],
  p_starts_at: syntheticStart, p_client_id: "55555555-5555-4555-8555-000000000001",
  p_notes: "Worker E2E sintético",
});
if (bookingError) throw bookingError;
console.log("syntheticBooking", booking);
const bookingId = booking.appointment_id;
async function waitForLines(expected) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const { data, error } = await sb.from("appointment_services")
      .select("service_id,staff_id,price,starts_at,ends_at").eq("appointment_id", bookingId).order("position");
    if (error) throw error;
    if (data.length === expected) return data;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`${role}: expected ${expected} service lines`);
}
const containerName = "bellza-agenda-worker-local";
writeFileSync("tmp/agenda-disposable/wrangler-local.json", JSON.stringify({
  name: "bellza-agenda-local", main: "/app/dist/server/index.js",
  assets: { directory: "/app/dist/client" }, compatibility_date: "2025-09-24",
  compatibility_flags: ["nodejs_compat"], no_bundle: true,
  rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
}));
execFileSync("docker", ["run", "-d", "--name", containerName, "-p", "4192:4192",
  "-v", `${resolve(".")}:/app`, "-v", "bellza_agenda_wrangler:/tmp/wrangler", "-w", "/tmp",
  "node:22-bookworm-slim", "node", "/app/tmp/agenda-disposable/worker-tcp-proxy.mjs",
  "/tmp/wrangler/node_modules/wrangler/bin/wrangler.js",
  "dev", "--config", "/app/tmp/agenda-disposable/wrangler-local.json", "--local", "--ip", "0.0.0.0", "--port", "4192",
  "--var", `SUPABASE_URL:${local.API_URL}`,
  "--var", `SUPABASE_PUBLISHABLE_KEY:${local.PUBLISHABLE_KEY}`,
  "--var", `SUPABASE_SERVICE_ROLE_KEY:${local.SERVICE_ROLE_KEY}`], { encoding: "utf8" });
let browser;
try {
  const base = "http://127.0.0.1:4192/";
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!ready) throw new Error("local_worker_not_ready");
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: role === "staff" || role === "desk_staff"
    ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
  await page.addInitScript(() => localStorage.setItem(
    "bellza:admin-quick-tour:11111111-1111-4111-8111-111111111111:studio_owner", "skipped"));
  if (role === "manager") await page.addInitScript(() => localStorage.setItem(
    "bellza:admin-quick-tour:11111111-1111-4111-8111-111111111111:manager", "skipped"));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) console.log("navigation", frame.url()); });
  await page.goto(`${base}login?returnTo=%2Fadmin%2Fagenda`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByLabel("Email ou WhatsApp").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/admin(?:\/agenda)?/, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.goto(`${base}admin/agenda?appointment=${bookingId}&studio=11111111-1111-4111-8111-111111111111`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Editar reserva" }).waitFor({ timeout: 15000 });
  for (const button of ["Compareceu", "Faltou", "Cancelar marcação", "Receber pagamento", "Editar reserva"]) {
    assert.equal(await page.getByRole("button", { name: button, exact: true }).count(), 1, `${role}: missing ${button}`);
  }
  await page.getByRole("button", { name: "Editar reserva" }).click();
  await page.getByRole("button", { name: "Adicionar serviço" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Adicionar serviço" }).click();
  await page.getByRole("button", { name: "Guardar alterações" }).click();
  await page.getByText("Marcação atualizada.").waitFor({ timeout: 10000 });
  const savedLines = await waitForLines(2);
  assert.equal(savedLines.length, 2, `${role}: add line`);
  assert.equal(savedLines[0].ends_at, savedLines[1].starts_at, `${role}: sequential times`);
  assert.equal(Number(savedLines[0].price) + Number(savedLines[1].price), 68, `${role}: total`);
  assert.notEqual(savedLines[0].staff_id, savedLines[1].staff_id, `${role}: distinct professionals`);
  await page.goto(`${base}admin/agenda?appointment=${bookingId}&studio=11111111-1111-4111-8111-111111111111`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Editar reserva" }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Editar reserva" }).click();
  await page.getByRole("button", { name: "Remover serviço 2" }).click();
  await page.getByRole("button", { name: "Guardar alterações" }).click();
  const reducedLines = await waitForLines(1);
  assert.equal(reducedLines.length, 1, `${role}: remove line`);
  assert.equal(Number(reducedLines[0].price), 28, `${role}: reduced total`);
  if (role === "studio_owner") {
    await page.goto(`${base}admin/agenda?appointment=${bookingId}&studio=11111111-1111-4111-8111-111111111111`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Editar reserva" }).click();
    await page.getByRole("dialog", { name: "Editar marcação" }).getByRole("combobox")
      .filter({ hasText: /Gel Sintético/ }).click();
    await page.getByRole("option", { name: /Pestanas Sintéticas/ }).click();
    assert.equal(await page.getByLabel("Preço / valor (€)").inputValue(), "40.00", "changed service price");
    await page.getByRole("button", { name: "Guardar alterações" }).click();
    for (let attempt = 0; attempt < 40; attempt++) {
      const { data, error } = await sb.from("appointment_services")
        .select("service_id,staff_id,price").eq("appointment_id", bookingId).single();
      if (error) throw error;
      if (data.service_id === "44444444-4444-4444-8444-000000000002") {
        assert.equal(data.staff_id, "33333333-3333-4333-8333-000000000002");
        assert.equal(Number(data.price), 40);
        break;
      }
      if (attempt === 39) throw new Error("same_count_service_change_not_saved");
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  const action = role === "studio_owner" || role === "desk_staff" ? "Compareceu"
    : role === "manager" ? "Faltou" : "Cancelar marcação";
  const expectedStatus = action === "Compareceu" ? "completed"
    : action === "Faltou" ? "no_show" : "cancelled";
  let actionBookingId = bookingId;
  if (action !== "Cancelar marcação") {
    const pastStart = new Date(Date.UTC(2026, 9, 29, 13, 30) - 7 * (1 + Math.floor(Math.random() * 100)) * 86400000);
    const { data: pastBooking, error: pastBookingError } = await actor.rpc("create_manual_multi_professional_appointment", {
      p_studio_id: "11111111-1111-4111-8111-111111111111",
      p_assignments: [{ serviceId: "44444444-4444-4444-8444-000000000001", staffId: "33333333-3333-4333-8333-000000000001" }],
      p_starts_at: pastStart.toISOString(), p_client_id: "55555555-5555-4555-8555-000000000001",
      p_notes: "Estado sintético",
    });
    if (pastBookingError) throw pastBookingError;
    actionBookingId = pastBooking.appointment_id;
  }
  if (action === "Compareceu") {
    const { error: zeroAppointmentError } = await sb.from("appointments")
      .update({ total_price: 0 }).eq("id", actionBookingId);
    if (zeroAppointmentError) throw zeroAppointmentError;
    const { error: zeroLineError } = await sb.from("appointment_services")
      .update({ price: 0 }).eq("appointment_id", actionBookingId);
    if (zeroLineError) throw zeroLineError;
  }
  await page.goto(`${base}admin/agenda?appointment=${actionBookingId}&studio=11111111-1111-4111-8111-111111111111`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: action, exact: true }).click();
  if (action === "Cancelar marcação") {
    await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
  }
  let actualStatus = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const { data, error } = await sb.from("appointments").select("status").eq("id", actionBookingId).single();
    if (error) throw error;
    actualStatus = data.status;
    if (actualStatus === expectedStatus) break;
    await new Promise((done) => setTimeout(done, 250));
  }
  assert.equal(actualStatus, expectedStatus, `${role}: ${action} server status`);
  if (action === "Compareceu") {
    const { data: movements, error } = await sb.from("cash_register_movements")
      .select("id").eq("appointment_id", actionBookingId);
    if (error) throw error;
    assert.equal(movements.length, 0, `${role}: no financial movement`);
  }
  assert.deepEqual(errors, [], `${role}: browser errors`);
  console.log(JSON.stringify({ role, viewport: role === "staff" || role === "desk_staff" ? "mobile" : "desktop",
    buttons: "visible", add: "passed", remove: "passed", sequential: "passed", amount: "passed",
    changeServiceAndProfessional: role === "studio_owner" ? "passed" : "covered_by_sql_test",
    action, status: actualStatus }));
} finally {
  await browser?.close();
  if (process.exitCode) try { process.stderr.write(execFileSync("docker", ["logs", "--tail", "40", containerName], { encoding: "utf8" })); } catch {}
  try { execFileSync("docker", ["stop", containerName], { stdio: "ignore" }); } catch {}
  try { execFileSync("docker", ["rm", containerName], { stdio: "ignore" }); } catch {}
}
