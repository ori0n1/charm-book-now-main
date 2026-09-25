import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260828230000_definitive_attendance_financial_settlement.sql";

function settlement(totalCents: number, receivedCents: number, outcome: "completed" | "no_show") {
  const received = Math.max(0, receivedCents);
  const onsiteAdded = outcome === "completed" ? Math.max(0, totalCents - Math.min(totalCents, received)) : 0;
  return { onsiteAdded, receivedAfter: Math.min(totalCents, received + onsiteAdded), pendingAfter: 0 };
}

test("attendance settlement covers unpaid, deposit, fully paid, cents, and overpayment", () => {
  expect(settlement(5000, 0, "completed")).toEqual({ onsiteAdded: 5000, receivedAfter: 5000, pendingAfter: 0 });
  expect(settlement(5000, 1000, "completed")).toEqual({ onsiteAdded: 4000, receivedAfter: 5000, pendingAfter: 0 });
  expect(settlement(5000, 5000, "completed")).toEqual({ onsiteAdded: 0, receivedAfter: 5000, pendingAfter: 0 });
  expect(settlement(1999, 501, "completed")).toEqual({ onsiteAdded: 1498, receivedAfter: 1999, pendingAfter: 0 });
  expect(settlement(5000, 6000, "completed")).toEqual({ onsiteAdded: 0, receivedAfter: 5000, pendingAfter: 0 });
});

test("no-show preserves prior receipt and creates no new receipt", () => {
  expect(settlement(5000, 0, "no_show")).toEqual({ onsiteAdded: 0, receivedAfter: 0, pendingAfter: 0 });
  expect(settlement(5000, 1000, "no_show")).toEqual({ onsiteAdded: 0, receivedAfter: 1000, pendingAfter: 0 });
  expect(settlement(5000, 5000, "no_show")).toEqual({ onsiteAdded: 0, receivedAfter: 5000, pendingAfter: 0 });
});

test("canonical ledger exposes potential no-show loss without creating debt", async () => {
  const { computeAppointmentLedger } = await import("../src/lib/financial-ledger");
  expect(computeAppointmentLedger("no-pay", 50, "no_show").lostRevenueCents).toBe(5000);
  expect(computeAppointmentLedger("deposit", 50, "no_show", {
    appointmentId: "deposit",
    onlineGrossCents: 1000,
    onsiteGrossCents: 0,
    refundedCents: 0,
    onlineNetCents: 1000,
    onsiteNetCents: 0,
    receivedCents: 1000,
  })).toMatchObject({ receivedCents: 1000, pendingCents: 0, realizedCents: 0, lostRevenueCents: 4000 });
});

test("database rule is cents-based, tenant-scoped, atomic and idempotent", () => {
  const sql = readFileSync(migrationPath, "utf8");
  expect(sql).toContain("round(coalesce(v_appointment.total_price, 0) * 100)::bigint");
  expect(sql).toContain("id = p_appointment_id");
  expect(sql).toContain("studio_id = p_studio_id");
  expect(sql).toContain("FOR UPDATE");
  expect(sql).toContain("attendance-settlement:");
  expect(sql).toContain("ON CONFLICT (source_key)");
  expect(sql).toContain("auth.role() <> 'service_role'");
  expect(sql).toContain("cardinality(p_appointment_ids) > 100");
  expect(sql).toContain("settle_appointment_attendance_core");
});

test("completed creates only the remainder while no-show cannot insert a movement", () => {
  const sql = readFileSync(migrationPath, "utf8");
  expect(sql).toContain("v_total_cents - least(v_total_cents, v_received_before_cents)");
  expect(sql).toMatch(/IF p_outcome = 'completed' THEN[\s\S]*INSERT INTO public\.cash_register_movements/);
  expect(sql).toContain("'attendance_no_show'");
  expect(sql).toContain("'pending_cents', 0");
});

test("individual and bulk UI use the same protected batch mutation", () => {
  const server = readFileSync("src/lib/agenda-access.functions.ts", "utf8");
  const agenda = readFileSync("src/routes/_authenticated/admin.agenda.tsx", "utf8");
  const sheet = readFileSync("src/components/agenda/attendance-pending-sheet.tsx", "utf8");
  expect(server).toContain('admin.rpc("resolve_appointment_attendance_batch"');
  expect(server).toContain("appointmentResult.data.length !== appointmentIds.length");
  expect(server).toContain("appointment.staff_id !== access.staffId");
  expect(agenda).toContain("markPresenceMany([appt], nextStatus)");
  expect(sheet).toContain("attendance-select-all");
  expect(sheet).toContain("attendance-bulk-completed");
  expect(sheet).toContain("attendance-bulk-no-show");
});
