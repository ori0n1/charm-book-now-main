import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

// Build a test-only module from the real editor and its local layout helpers.
// Importing the route itself starts TanStack's server graph and its virtual
// entries, which cannot be resolved by a plain Vite fixture.
const root = process.cwd();
const source = readFileSync(resolve(root, "src/routes/_authenticated/admin.agenda.tsx"), "utf8");
function slice(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `missing editor source boundary: ${from}`);
  return source.slice(start, end);
}
const editor = slice("function EditAppointmentModal(", "// ─── Reschedule Modal")
  .replace("function EditAppointmentModal(", "export function EditAppointmentModal(");
const generated = `
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
import { useModalScrollLock } from "@/lib/modal-scroll-lock";
import { formatEUR } from "@/lib/utils";
import { getStudioDateKey, formatStudioTime } from "@/lib/studio-time";
import { isManualAppointmentServiceAllowed, manualAppointmentStaffForService, tenantScopedStaffServiceLinks } from "@/lib/manual-appointment-selection";
type Appt = any;
type StudioService = { id: string; name: string; price: number; duration_min: number; commission_percent?: number | null };
type StudioStaff = { id: string; name: string; commission_percent?: number | null };
type ManualAppointmentStaffServiceLink = { staff_id: string; service_id: string };
const studioId = "11111111-1111-4111-8111-111111111111";
const services = [
 { id:"44444444-4444-4444-8444-444444444444", name:"Serviço A", price:50, duration_min:90, commission_percent:20 },
 { id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name:"Serviço B", price:70, duration_min:75, commission_percent:35 }
];
const staff = [
 { id:"33333333-3333-4333-8333-333333333333", name:"Profissional A", commission_percent:25 },
 { id:"99999999-9999-4999-8999-999999999999", name:"Profissional B", commission_percent:30 }
];
const links = [
 { staff_id:staff[0].id, service_id:services[0].id },
 { staff_id:staff[0].id, service_id:services[1].id },
 { staff_id:staff[1].id, service_id:services[1].id }
];
function query(table) {
 const data = table === "services" ? services : table === "staff" ? staff : links;
 const chain = { select(){return this}, eq(){return this}, match(){return this}, order(){return this},
   then(ok,fail){return Promise.resolve({ data, error:null }).then(ok,fail)} };
 return chain;
}
const supabase = { from:query, rpc:async()=>({error:null}) };
const useServerFn = (fn)=>fn;
const resolveStudioLocalDateTime = async ({data})=>({startsAt:data.date+"T"+data.time+":00Z"});
const previewStudioScheduleChange = async ()=>({hasConflict:false,hardBlocked:false,withinAvailability:true});
const updateProtectedResolvedAppointmentNotes = async ()=>({ok:true});
const updateProtectedResolvedAppointmentFull = async ({data})=>{
 window.__editorSaves.push(data);
 return {appointmentId:data.appointmentId,status:data.expectedStatus};
};
${slice("function appointmentDurationMinutes(", "function formatShortAppointment(")}
${slice("function AppointmentTimePicker(", "function ModalShell(")}
${slice("function ModalShell(", "// ─── Client Avatar")}
${slice("function formatManualAppointmentError(", "function computeAppointmentSplit(")}
${editor}
`;
const generatedPath = resolve(root, "tests/evidence/.full-edit-visual.generated.tsx");
const htmlPath = resolve(root, "tests/evidence/.full-edit-visual.html");
writeFileSync(generatedPath, generated);
writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tests/evidence/full-edit-visual-style.css"></head><body><div id="root"></div><script type="module" src="/tests/evidence/full-edit-visual-fixture.tsx"></script></body></html>`);

const mobile = process.argv.includes("--mobile");
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 };
const cssName = readdirSync(resolve(root, "dist/client/assets")).find((name) => /^styles-.*\.css$/.test(name));
assert.ok(cssName, "compiled CSS is required");
const css = readFileSync(resolve(root, "dist/client/assets", cssName));
const server = await createServer({ root, configFile:false, appType:"mpa",
  resolve:{ alias:{ "@":resolve(root,"src") } },
  optimizeDeps:{ noDiscovery:true, include:["react","react/jsx-runtime","react/jsx-dev-runtime","react-dom","react-dom/client"] },
  server:{ host:"127.0.0.1", port:4194, strictPort:true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
  const page = await browser.newPage({viewport});
  const errors = [];
  page.on("pageerror", (error)=>errors.push(error.message));
  await page.route("**/tests/evidence/full-edit-visual-style.css", (route)=>
    route.fulfill({status:200,contentType:"text/css",body:css}));
  await page.goto("http://127.0.0.1:4194/tests/evidence/.full-edit-visual.html");
  for (const name of ["Editar Compareceu","Editar Faltou","Editar vários serviços","Editar serviço conjunto","Editar com comissão liquidada","Editar vários serviços recebidos","Editar conjunto recebido","Editar confirmação recebida"]) {
    await page.getByRole("button",{name,exact:true}).click();
    const dialog = page.getByRole("dialog",{name:"Editar marcação"});
    await dialog.waitFor();
    {
      await dialog.getByLabel("Preço / valor (€)").waitFor();
      const paid = ["Editar com comissão liquidada","Editar vários serviços recebidos","Editar conjunto recebido","Editar confirmação recebida"].includes(name);
      assert.equal(await dialog.getByLabel("Preço / valor (€)").isDisabled(),paid);
      if (paid) {
        assert.equal(await dialog.getByText("Para preservar o pagamento e a comissão já registados, estes campos não podem ser alterados após o recebimento.").count(),1);
        assert.equal(await dialog.getByRole("combobox").nth(2).isDisabled(),true);
        assert.equal(await dialog.getByRole("combobox").nth(3).isDisabled(),true);
      }
      assert.equal(await dialog.getByLabel("Duração individual em minutos").count(),
        ["Editar vários serviços","Editar serviço conjunto","Editar vários serviços recebidos","Editar conjunto recebido"].includes(name)?2:1);
      const footer = dialog.getByRole("button",{name:"Guardar alterações"});
      const back = dialog.getByRole("button",{name:"Voltar"});
      const close = dialog.getByRole("button",{name:"Fechar Editar marcação"});
      for (const control of [footer,back,close]) {
        const box = await control.boundingBox();
        assert.ok(box && box.y>=0 && box.y+box.height<=viewport.height,
          "modal control must stay within viewport");
      }
      const notes = dialog.getByRole("textbox",{name:"Notas"});
      await notes.scrollIntoViewIfNeeded();
      const noteBox = await notes.boundingBox();
      const footerBox = await footer.boundingBox();
      assert.ok(noteBox && footerBox && noteBox.y+noteBox.height<=footerBox.y,
        "fields must not overlap the footer");
      if (name==="Editar Compareceu") {
        assert.equal(await dialog.locator('input[type="time"]').count(),0);
        await dialog.getByRole("combobox",{name:"Hora"}).click();
        await page.getByRole("option",{name:"11",exact:true}).click();
        await dialog.getByRole("combobox",{name:"Minutos"}).click();
        await page.getByRole("option",{name:"30",exact:true}).click();
        assert.match(await dialog.getByRole("combobox",{name:"Hora"}).innerText(),/11/);
        assert.match(await dialog.getByRole("combobox",{name:"Minutos"}).innerText(),/30/);
        await page.screenshot({path:`tests/evidence/appointment-edit-controls-${mobile?"mobile":"desktop"}.png`});
        await dialog.getByLabel("Preço / valor (€)").fill("70");
        await footer.click();
        await dialog.getByRole("button",{name:"Confirmar alterações"}).waitFor();
        assert.equal(await page.evaluate(()=>window.__editorSaves.length),0);
        assert.ok(await dialog.getByText(/Antes:/).count());
        assert.ok(await dialog.getByText(/Depois:/).count());
      }
      if (paid) {
        const savesBefore = await page.evaluate(()=>window.__editorSaves.length);
        await dialog.getByLabel("Duração individual em minutos").first().fill("120");
        await footer.click();
        await dialog.waitFor({state:"detached"});
        const saves = await page.evaluate(()=>window.__editorSaves);
        assert.equal(saves.length,savesBefore+1);
        const saved = saves.at(-1);
        assert.equal(saved.appointmentId,"55555555-5555-4555-8555-555555555555");
        assert.equal(saved.expectedStatus,name==="Editar confirmação recebida"?"confirmed":"completed");
        assert.equal(saved.totalPrice,["Editar vários serviços recebidos","Editar conjunto recebido"].includes(name)?80:50);
        assert.equal(saved.assignments[0].durationMin,120);
        continue;
      }
    }
    await dialog.getByRole("button",{name:/Fechar/}).click();
  }
  assert.deepEqual(errors,[]);
  console.log(`full edit visual ${mobile?"mobile":"desktop"}: OK`);
} finally {
  await browser?.close();
  await server.close();
  rmSync(generatedPath,{force:true});
  rmSync(htmlPath,{force:true});
}
