import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBookingRequestMessage,
  buildBookingRequestWhatsappUrl,
  normalizeWhatsappRecipient,
} from "../src/lib/booking-request";

const projectFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const requestInput = {
  studioWhatsapp: "+351 912 345 678",
  studioName: "Bellza Studio",
  clientName: "Ana Silva",
  clientPhone: "+351 934 567 890",
  clientEmail: "ana@example.com",
  serviceNames: ["Corte", "Coloração"],
  preferredProfessional: "Marta",
  intendedDate: new Date(2026, 8, 15, 12, 0, 0),
  intendedTime: "14:30",
  quotedTotal: 137.5,
  notes: "Sem amoníaco",
};

test("builds an honest, complete WhatsApp request without confirmation language", () => {
  const message = buildBookingRequestMessage(requestInput);
  expect(message).toContain("Corte + Coloração");
  expect(message).toContain("Marta (não garantida)");
  expect(message).toContain("Horário pretendido: 14:30");
  expect(message).toContain("Valor informado: 137,50 €");
  expect(message).toContain("apenas uma solicitação");
  expect(message).toContain("só ficam confirmados após resposta do estúdio");
});

test("normalizes the WhatsApp recipient and URL-encodes personal data", () => {
  expect(normalizeWhatsappRecipient("00351 912 345 678")).toBe("351912345678");
  const url = buildBookingRequestWhatsappUrl(requestInput);
  expect(url).toMatch(/^https:\/\/wa\.me\/351912345678\?text=/);
  expect(url).not.toContain("ana@example.com");
  expect(() => buildBookingRequestWhatsappUrl({ ...requestInput, studioWhatsapp: "123" })).toThrow(
    "WhatsApp do estúdio",
  );
});

test("request submission cannot create appointments, clients, payments or notifications", () => {
  const component = projectFile("src/components/booking-experience.tsx");
  const start = component.indexOf("function submitBookingRequest()");
  const end = component.indexOf("\n  return (", start);
  const requestSubmission = component.slice(start, end);

  expect(requestSubmission).toContain("buildBookingRequestWhatsappUrl");
  expect(requestSubmission).not.toContain("createPublicBooking(");
  expect(requestSubmission).not.toContain("syncPublicClientProfile(");
  expect(requestSubmission).not.toContain("dispatchPublicBookingSideEffects(");
  expect(requestSubmission).not.toContain("setConfirmed(true)");
});

test("server and database reject online booking creation while request mode is active", () => {
  const server = projectFile("src/lib/public-booking.functions.ts");
  const migration = projectFile(
    "supabase/migrations/20260831120000_booking_request_professional_control.sql",
  );
  expect(server).toContain('effectiveBookingMode === "request"');
  expect(server).toContain('studio_has_entitlement');
  expect(server).toContain('translateBookingError("booking_request_mode_only")');
  expect(migration).toContain("IF v_mode <> 'online' THEN RAISE EXCEPTION 'booking_request_mode_only'");
  expect(migration).toContain("REVOKE ALL ON FUNCTION public.create_public_booking_online_core");
});

test("studio settings preserve online booking as the opt-in-safe default", () => {
  const migration = projectFile(
    "supabase/migrations/20260831120000_booking_request_professional_control.sql",
  );
  const settings = projectFile("src/routes/_authenticated/admin.marca.tsx");
  expect(migration).toContain("booking_flow_mode text NOT NULL DEFAULT 'online'");
  expect(migration).toContain("booking_request_professional_mode text NOT NULL DEFAULT 'hidden'");
  for (const mode of ["hidden", "showcase", "preference"]) {
    expect(settings).toContain(`["${mode}"`);
  }
});
