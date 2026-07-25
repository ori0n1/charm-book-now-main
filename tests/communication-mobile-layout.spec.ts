import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("communication campaign cards use a compact two-column mobile grid", async () => {
  const source = await readFile("src/routes/_authenticated/admin.whatsapp.tsx", "utf8");

  expect(source).toContain("grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]");
  expect(source).toContain("min-h-[6.25rem]");
  expect(source).toContain("sm:min-h-[3.9rem] sm:flex-row");
  expect(source).toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
});

test("WhatsApp card exposes only the approved booking confirmation toggle", async () => {
  const [source, capabilities] = await Promise.all([
    readFile("src/routes/_authenticated/admin.whatsapp.tsx", "utf8"),
    readFile("src/lib/whatsapp-product-capabilities.ts", "utf8"),
  ]);

  expect(source).toContain("Ativar envio");
  expect(source).toContain("template aprovado");
  expect(source).not.toContain("Ver mais");
  expect(source).not.toContain("Mensagem padrão");
  expect(source).not.toContain("Testar envio");
  expect(source).not.toContain("testWhatsAppMessage");

  expect(capabilities).toContain('purpose: "appointment_reminder"');
  expect(capabilities).toContain('availability: "planned"');
  expect(capabilities).toContain("enabled: false");
});
