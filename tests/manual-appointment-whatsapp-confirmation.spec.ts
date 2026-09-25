import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  appointmentConfirmationIdempotencyKey,
  shouldSendAutomaticManualAppointmentConfirmation,
} from "../src/lib/appointment-whatsapp-policy";

test("uses one confirmation idempotency key per appointment across every booking path", () => {
  const appointmentId = "6f533adc-2be7-46f8-864f-350354c9be62";
  expect(appointmentConfirmationIdempotencyKey(appointmentId, "public-fallback")).toBe(
    appointmentConfirmationIdempotencyKey(appointmentId, "payment-fallback"),
  );
});

test("allows automatic confirmation for regular appointments but never for walk-ins", () => {
  expect(shouldSendAutomaticManualAppointmentConfirmation("confirmed")).toBe(true);
  expect(shouldSendAutomaticManualAppointmentConfirmation("completed")).toBe(false);
  expect(shouldSendAutomaticManualAppointmentConfirmation("cancelled")).toBe(false);
});

test("manual agenda creation dispatches confirmation while the walk-in flow does not", async () => {
  const agenda = await readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");
  const frontDesk = await readFile("src/routes/_authenticated/admin.balcao.tsx", "utf8");

  expect(agenda).toContain("sendManualAppointmentConfirmationForAppointment");
  expect(agenda).toContain('if (creationMode === "standard")');
  expect(agenda).toContain("sendManualAppointmentConfirmation({ data: { appointmentId } })");
  expect(agenda).toContain("createStudioManualFit");
  expect(agenda).toContain("createManualFit({");
  expect(agenda).toContain("p_is_fit: false");
  expect(agenda).toContain('"create_manual_appointment"');
  expect(agenda).toContain("await Promise.allSettled([");
  expect(frontDesk).not.toContain("sendManualAppointmentConfirmationForAppointment");
});

test("appointment confirmation loads the real client explicitly and never sends a generic name", async () => {
  const source = await readFile("src/lib/whatsapp.functions.ts", "utf8");
  const contextLoader = source.slice(
    source.indexOf("async function loadAppointmentConfirmationContext"),
  );

  expect(contextLoader).toContain('.from("clients")');
  expect(contextLoader).toContain('.eq("id", appt.client_id)');
  expect(contextLoader).toContain("const realClientName");
  expect(contextLoader).toContain("return null;");
  expect(contextLoader).toContain("clientName: realClientName");
  expect(contextLoader).not.toContain('clientName: appt.clients?.name ?? "Cliente"');
});

test("new-client booking keeps the typed name even when the phone already exists", async () => {
  const agenda = await readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");
  const migration = await readFile(
    "supabase/migrations/20260823220000_prelaunch_security_hardening.sql",
    "utf8",
  );

  expect(agenda).toContain("const normalizedNewClientName = newClientName.trim()");
  expect(agenda).toContain("p_client_name: isNewClient ? normalizedNewClientName : null");
  expect(migration).toContain("ON CONFLICT (studio_id, phone) DO UPDATE");
  expect(migration).toContain("SET name = EXCLUDED.name, updated_at = now()");
  expect(migration).toContain("RETURNING id INTO v_client_id");
});
