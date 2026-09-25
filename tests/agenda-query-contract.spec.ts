import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { selectVisibleAgendaAppointments } from "../src/lib/agenda-access.functions";

const agendaAccessSource = readFile("src/lib/agenda-access.functions.ts", "utf8");
const agendaRouteSource = readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");

test("Agenda selects clients and staff through the tenant-safe appointment relationships", async () => {
  const [access, route] = await Promise.all([agendaAccessSource, agendaRouteSource]);

  expect(access).toContain(
    "clients:clients!appointments_client_same_studio(name,phone,avatar_url,date_of_birth)",
  );
  expect(access).toContain(
    "staff:staff!appointments_staff_same_studio(id,name,commission_percent,deposit_recipient,deposit_professional_percent)",
  );
  expect(access).toContain(
    '.select("clients:clients!appointments_client_same_studio(id,name,phone)")',
  );
  expect(route).toContain(
    '.select("clients:clients!appointments_client_same_studio(id,name,phone)")',
  );
  expect(access).not.toContain("clients(name,phone,avatar_url,date_of_birth)");
  expect(access).not.toContain("staff(id,name,commission_percent");
  expect(access).not.toContain('.select("clients(id,name,phone)")');
  expect(route).not.toContain('.select("clients(id,name,phone)")');
});

test("Agenda financial projections only request columns present in production", async () => {
  const access = await agendaAccessSource;

  expect(access).toContain('.select("id,appointment_id,amount_cents,status")');
  expect(access).toContain(
    '.select("id,appointment_id,payment_intent_id,status,payment_intents(amount_cents)")',
  );
  expect(access).not.toContain("dispute_status");
  expect(access).not.toContain("disputed_amount_cents");
  expect(access).not.toContain("id,appointment_id,payment_intent_id,amount_cents,status");
});

test("Agenda preserves studio scoping on every affected appointment query", async () => {
  const [access, route] = await Promise.all([agendaAccessSource, agendaRouteSource]);

  expect(access).toContain('.eq("studio_id", data.studioId)');
  expect(access).toContain('.eq("staff_id", ownStaffId)');
  expect(route).toContain('.eq("studio_id", studioId)');
  expect(route).toContain('.eq("staff_id", staffId)');
});

test("Agenda returns every legitimate repeated appointment without changing relation shape", () => {
  const repeated = ["appointment-1", "appointment-2", "appointment-3"].map((id) => ({
    id,
    starts_at: "2026-09-25T10:00:00.000Z",
    ends_at: "2026-09-25T11:00:00.000Z",
    status: "confirmed",
    clients: { name: "Cliente", phone: "+351000000000" },
    staff: { id: "staff-1", name: "Profissional" },
    appointment_services: [{ services: { name: "Serviço" } }],
  }));

  const result = selectVisibleAgendaAppointments(
    repeated,
    { role: "manager", staffId: null },
    "private",
  );

  expect(result.map((appointment) => appointment.id)).toEqual([
    "appointment-1",
    "appointment-2",
    "appointment-3",
  ]);
  expect(result[0].clients).toEqual(repeated[0].clients);
  expect(result[0].staff).toEqual(repeated[0].staff);
});
