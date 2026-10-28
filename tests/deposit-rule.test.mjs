import test from "node:test";
import assert from "node:assert/strict";
import { calculateDepositCharge, readDepositRule, readDepositSnapshot } from "../src/lib/deposit-rule.ts";

test("existing percent settings remain percent and use the authoritative multi-service total", () => {
  const rule = readDepositRule({ deposit_percent: 20, studio_policy_settings: {} });
  assert.deepEqual(rule, { mode: "percent", percent: 20 });
  assert.deepEqual(calculateDepositCharge(15000, rule), {
    amountCents: 3000, remainingCents: 12000, isFullPayment: false,
  });
});

test("fixed deposit applies once to a multi-service reservation", () => {
  const rule = readDepositRule({ deposit_percent: 20, studio_policy_settings: {
    deposit_mode: "fixed", deposit_fixed_cents: 1000,
  } });
  assert.deepEqual(calculateDepositCharge(15000, rule), {
    amountCents: 1000, remainingCents: 14000, isFullPayment: false,
  });
  assert.deepEqual(calculateDepositCharge(800, rule), {
    amountCents: 800, remainingCents: 0, isFullPayment: true,
  });
});

test("snapshots protect open bookings when the studio changes mode", () => {
  const studio = { deposit_percent: 20, studio_policy_settings: {
    deposit_mode: "fixed", deposit_fixed_cents: 1000,
  } };
  assert.deepEqual(readDepositSnapshot({ mode: "percent", percent: 20 }, studio),
    { mode: "percent", percent: 20 });
  assert.deepEqual(readDepositSnapshot(null, studio), { mode: "percent", percent: 20 });
  assert.deepEqual(readDepositSnapshot({ mode: "fixed", fixed_cents: 1000 },
    { deposit_percent: 100 }), { mode: "fixed", fixed_cents: 1000 });
});

test("invalid fixed settings and totals are rejected", () => {
  assert.throws(() => readDepositRule({ deposit_percent: 20, studio_policy_settings: {
    deposit_mode: "unknown",
  } }));
  assert.throws(() => readDepositRule({ deposit_percent: 20, studio_policy_settings: {
    deposit_mode: "fixed", deposit_fixed_cents: -100,
  } }));
  assert.throws(() => calculateDepositCharge(0, { mode: "fixed", fixed_cents: 1000 }));
  assert.throws(() => readDepositSnapshot({ mode: "fixed", fixed_cents: 10 }, {}));
});
