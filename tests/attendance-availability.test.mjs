import assert from "node:assert/strict";
import test from "node:test";
import { getAppointmentLifecycleStage } from "../src/lib/appointment-lifecycle.ts";

test("attendance opens only after the studio grace period for an unpaid confirmed booking", () => {
  const startsAt = "2026-11-11T10:00:00Z";
  const at = (now) => getAppointmentLifecycleStage({
    status: "confirmed", startsAt, now, graceMinutes: 30,
  });
  assert.equal(at("2026-11-11T09:59:59Z"), "scheduled");
  assert.equal(at("2026-11-11T10:29:59Z"), "awaiting_service");
  assert.equal(at("2026-11-11T10:30:00Z"), "awaiting_confirmation");
  assert.equal(getAppointmentLifecycleStage({ status: "cancelled", startsAt,
    now: "2026-11-11T11:00:00Z", graceMinutes: 30 }), "cancelled");
});
