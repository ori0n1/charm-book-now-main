import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("Minhas Reservas exposes policy-aware reschedule and cancellation actions", async () => {
  const [clientArea, bookingUi] = await Promise.all([
    readFile("src/lib/public-client.functions.ts", "utf8"),
    readFile("src/components/booking-experience.tsx", "utf8"),
  ]);

  expect(clientArea).toContain("getBookingManageability");
  expect(clientArea).toContain("getStudioBookingActionSetting");
  expect(clientArea).toContain("cancellation_min_notice_hours");
  expect(clientArea).toContain("studio_policy_settings");
  expect(clientArea).toContain("created_at,starts_at");

  expect(bookingUi).toContain("ReservationManagementActions");
  expect(bookingUi).toContain("Remarcar");
  expect(bookingUi).toContain("Cancelar reserva");
  expect(bookingUi).toContain("?acao=remarcar");
  expect(bookingUi).toContain("?acao=cancelar");
  expect(bookingUi).toContain("rescheduleBlockReason");
  expect(bookingUi).toContain("cancellationReason");
  expect(bookingUi).toContain("grid grid-cols-2 gap-2");
  expect(bookingUi).toContain("whitespace-nowrap");
});

test("reservation mutations revalidate studio policy on the server", async () => {
  const source = await readFile("src/lib/client-appointment.functions.ts", "utf8");

  expect(source.match(/const policy = getActionPolicy\(appt\)/g)?.length).toBeGreaterThanOrEqual(4);
  expect(source).toContain("if (!policy.canReschedule)");
  expect(source).toContain("if (!policy.canCancel)");
  expect(source).toContain("getStudioBookingActionSetting");
  expect(source).toContain("cancelledAppointment");
});
