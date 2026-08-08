import { expect, test } from "@playwright/test";
import { validateConfirmedBookingResult } from "../src/lib/booking";

const appointmentId = "87c5c3e0-6f69-4a49-b086-cf782b9d51f1";
const requestId = "bd4f2c57-09ae-42e1-9763-89f33f68f6ac";

function result(overrides: Record<string, unknown> = {}) {
  return {
    appointment_id: appointmentId,
    booking_request_id: null,
    studio_id: "99f2ab87-589e-4019-a855-0aafc8b9056c",
    starts_at: "2026-08-08T10:00:00Z",
    ends_at: "2026-08-08T10:45:00Z",
    total_price: 30,
    total_duration_min: 45,
    requires_payment: false,
    ...overrides,
  };
}

test.describe("public booking confirmation proof", () => {
  test("accepts a real appointment returned by the backend", () => {
    expect(validateConfirmedBookingResult(result()).appointment_id).toBe(appointmentId);
  });

  test("accepts a payment reservation backed by a server request id", () => {
    const validated = validateConfirmedBookingResult(
      result({ appointment_id: null, booking_request_id: requestId, requires_payment: true }),
    );
    expect(validated.booking_request_id).toBe(requestId);
  });

  test("never confirms from empty, malformed, URL, or residual client state", () => {
    for (const payload of [
      null,
      {},
      result({ appointment_id: null }),
      result({ appointment_id: "success" }),
      result({ appointment_id: null, booking_request_id: null, requires_payment: true }),
    ]) {
      expect(() => validateConfirmedBookingResult(payload)).toThrow(
        "Não foi possível confirmar a reserva.",
      );
    }
  });
});
