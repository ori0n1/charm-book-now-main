import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateConfirmedBookingResult } from "../src/lib/booking";
import {
  allocateAuthoritativeLineTotals,
  computeAttendanceRevenue,
} from "../src/lib/utils";

const appointmentId = "11111111-1111-4111-8111-111111111111";
const studioId = "22222222-2222-4222-8222-222222222222";

function bookingResult(totalPrice: number) {
  return validateConfirmedBookingResult({
    appointment_id: appointmentId,
    booking_request_id: null,
    studio_id: studioId,
    starts_at: "2026-08-25T10:00:00.000Z",
    ends_at: "2026-08-25T11:00:00.000Z",
    total_price: totalPrice,
    total_duration_min: 60,
    requires_payment: false,
    reservation_status: "confirmed",
    payment_status: "pay_in_studio",
  });
}

test("one service keeps the backend appointment total", () => {
  expect(bookingResult(150).total_price).toBe(150);
  expect(allocateAuthoritativeLineTotals(150, [150])).toEqual([150]);
});

test("multiple differently priced services reconcile to the unique backend total", () => {
  const lines = allocateAuthoritativeLineTotals(137, [100, 50]);
  expect(lines).toEqual([91.33, 45.67]);
  expect(lines.reduce((sum, value) => sum + value, 0)).toBe(137);
});

test("discounted multi-service allocation remains exact to the cent", () => {
  const lines = allocateAuthoritativeLineTotals(137.01, [80, 40, 30]);
  expect(lines.reduce((sum, value) => Math.round((sum + value) * 100) / 100, 0)).toBe(137.01);
  expect(lines.every((value) => value >= 0)).toBe(true);
});

test("total, deposit already paid and pending balance remain separate concepts", () => {
  const onsite = computeAttendanceRevenue(150, 0, "confirmed");
  expect(onsite.depositReceived).toBe(0);
  expect(onsite.remaining).toBe(150);

  const deposit = computeAttendanceRevenue(150, 37.5, "confirmed");
  expect(deposit.depositReceived).toBe(37.5);
  expect(deposit.remaining).toBe(112.5);

  const fullyPaid = computeAttendanceRevenue(150, 150, "confirmed");
  expect(fullyPaid.depositReceived).toBe(150);
  expect(fullyPaid.remaining).toBe(0);
});

test("invalid backend financial payloads cannot reach confirmation", () => {
  expect(() => bookingResult(Number.NaN)).toThrow();
  expect(() => bookingResult(-1)).toThrow();
});

test("public confirmation and checkout use the backend-returned total", () => {
  const source = readFileSync("src/components/booking-experience.tsx", "utf8");
  const serverSource = readFileSync("src/lib/public-booking.functions.ts", "utf8");
  expect(source).toContain("getProtectedPublicBookingQuote");
  expect(source).toContain("selectedTotal={bookingQuote?.key === bookingQuoteKey ? quotedTotal : null}");
  expect(source).toContain("setConfirmedTotal(result.total_price)");
  expect(source).toContain("setConfirmedStartsAt(result.starts_at)");
  expect(source).toContain("formatStudioDateTime(confirmedStartsAt, studio.timezone)");
  expect(source).toContain("totalPrice={authoritativeTotal}");
  expect(source).toContain("total={authoritativeTotal}");
  expect(serverSource).toContain('admin.rpc("quote_public_booking"');
});

test("backend confirmation rejects local datetimes without an offset", () => {
  const valid = bookingResult(100);
  expect(() => validateConfirmedBookingResult({
    ...valid,
    starts_at: "2026-08-25T10:00:00",
  })).toThrow();
});

test("paid booking requests snapshot prices and do not silently follow catalogue changes", () => {
  const migration = readFileSync(
    "supabase/migrations/20260824120000_appointment_price_single_source.sql",
    "utf8",
  );
  expect(migration).toContain("pricing_snapshot jsonb NOT NULL");
  expect(migration).toContain("capture_booking_payment_pricing_snapshot");
  expect(migration).toContain("quote_public_booking");
  expect(migration).toContain("jsonb_to_recordset(v_req.pricing_snapshot)");
  expect(migration).toContain("Compatibility for a checkout created before this migration");
});

test("manual appointments snapshot the same service price into total and line", () => {
  const migration = readFileSync(
    "supabase/migrations/20260823220000_prelaunch_security_hardening.sql",
    "utf8",
  );
  expect(migration).toContain("v_service.price, v_service.duration_min");
  expect(migration).toContain("v_appointment_id, v_service.id, false, v_service.price");
});

test("agenda, public details, finance, notifications and reports read appointment total_price", () => {
  const files = [
    "src/routes/_authenticated/admin.agenda.tsx",
    "src/lib/client-appointment.functions.ts",
    "src/lib/financial-report.functions.ts",
    "supabase/migrations/20260522173500_fix_appointment_notification_services.sql",
    "src/lib/platform-metrics-core.ts",
  ];
  for (const file of files) {
    expect(readFileSync(file, "utf8"), file).toContain("total_price");
  }
});
