import { expect, test } from "@playwright/test";
import { getBookingManageability } from "../src/lib/booking-manageability";

const policy = {
  cancellationNoticeHours: 24,
  afterDeadlinePolicy: "refund_allowed",
  refundRequestsEnabled: true,
  paymentPolicy: "pre_payment",
  depositPercent: 100,
};

test.describe("booking manageability", () => {
  test("allows cancellation and reschedule when the booking is created before the deadline and now is before it", () => {
    const result = getBookingManageability(
      {
        startsAt: "2026-07-03T09:00:00+01:00",
        endsAt: "2026-07-03T10:00:00+01:00",
        createdAt: "2026-07-01T12:45:00+01:00",
        status: "confirmed",
      },
      policy,
      "Europe/Lisbon",
      "2026-07-02T08:30:00+01:00",
    );

    expect(result.canCancel).toBe(true);
    expect(result.canReschedule).toBe(true);
    expect(result.statusReason).toBe("available");
    expect(result.manageabilityText).toContain("Pode cancelar até");
    expect(result.rescheduleManageabilityText).toContain("Pode remarcar até");
  });

  test("blocks and hides the old deadline when the booking was created after the theoretical deadline", () => {
    const result = getBookingManageability(
      {
        startsAt: "2026-07-03T09:00:00+01:00",
        endsAt: "2026-07-03T10:00:00+01:00",
        createdAt: "2026-07-02T12:45:00+01:00",
        status: "confirmed",
      },
      policy,
      "Europe/Lisbon",
      "2026-07-02T12:50:00+01:00",
    );

    expect(result.canCancel).toBe(false);
    expect(result.canReschedule).toBe(false);
    expect(result.statusReason).toBe("created_after_deadline");
    expect(result.manageabilityText).toBe(
      "Esta marcação foi criada fora do prazo de cancelamento/remarcação definido pelo estúdio.",
    );
  });

  test("supports a separate reschedule deadline while keeping cancellation available", () => {
    const result = getBookingManageability(
      {
        startsAt: "2026-07-03T09:00:00+01:00",
        endsAt: "2026-07-03T10:00:00+01:00",
        createdAt: "2026-07-01T12:45:00+01:00",
        status: "confirmed",
      },
      { ...policy, cancellationNoticeHours: 12, rescheduleNoticeHours: 24 },
      "Europe/Lisbon",
      "2026-07-02T10:00:00+01:00",
    );

    expect(result.canCancel).toBe(true);
    expect(result.canReschedule).toBe(false);
    expect(result.statusReason).toBe("available");
    expect(result.rescheduleStatusReason).toBe("deadline_expired");
  });

  test("respects independent studio switches for cancellation and reschedule", () => {
    const result = getBookingManageability(
      {
        startsAt: "2026-07-03T09:00:00+01:00",
        endsAt: "2026-07-03T10:00:00+01:00",
        createdAt: "2026-07-01T12:45:00+01:00",
        status: "confirmed",
      },
      {
        ...policy,
        cancellationEnabled: false,
        rescheduleEnabled: true,
      },
      "Europe/Lisbon",
      "2026-07-02T08:30:00+01:00",
    );

    expect(result.canCancel).toBe(false);
    expect(result.canReschedule).toBe(true);
    expect(result.statusReason).toBe("disabled_by_studio");
    expect(result.blockReason).toBe("O estúdio não permite cancelamentos online.");
  });

  test("never allows completed or no-show reservations to be changed", () => {
    for (const status of ["completed", "no_show"]) {
      const result = getBookingManageability(
        {
          startsAt: "2026-07-03T09:00:00+01:00",
          endsAt: "2026-07-03T10:00:00+01:00",
          createdAt: "2026-07-01T12:45:00+01:00",
          status,
        },
        policy,
        "Europe/Lisbon",
        "2026-07-02T08:30:00+01:00",
      );

      expect(result.canCancel).toBe(false);
      expect(result.canReschedule).toBe(false);
      expect(result.statusReason).toBe("status_not_manageable");
    }
  });

  test("blocks when now is after the deadline even if the booking was created before it", () => {
    const result = getBookingManageability(
      {
        startsAt: "2026-07-03T09:00:00+01:00",
        endsAt: "2026-07-03T10:00:00+01:00",
        createdAt: "2026-07-01T12:45:00+01:00",
        status: "confirmed",
      },
      policy,
      "Europe/Lisbon",
      "2026-07-02T09:01:00+01:00",
    );

    expect(result.canCancel).toBe(false);
    expect(result.canReschedule).toBe(false);
    expect(result.statusReason).toBe("deadline_expired");
    expect(result.manageabilityText).toBe("O prazo de cancelamento/remarcação já passou.");
  });

  test("blocks same-day bookings created inside the notice window without shifting dates by timezone", () => {
    const result = getBookingManageability(
      {
        startsAt: "2026-07-02T18:00:00+01:00",
        endsAt: "2026-07-02T19:00:00+01:00",
        createdAt: "2026-07-02T09:00:00+01:00",
        status: "confirmed",
      },
      policy,
      "Europe/Lisbon",
      "2026-07-02T09:05:00+01:00",
    );

    expect(result.canCancel).toBe(false);
    expect(result.canReschedule).toBe(false);
    expect(result.statusReason).toBe("created_after_deadline");
    expect(result.deadlineText).toContain("01 de julho");
  });
});
