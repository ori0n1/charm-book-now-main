import assert from "node:assert/strict";
import test from "node:test";
import { comparableBookingPaymentPhone } from "../src/lib/booking-payment-phone.ts";

test("payment ownership keeps account markers distinct", () => {
  const owner = "account:abcde";
  const other = "account:vwxyz";
  assert.equal(comparableBookingPaymentPhone(owner), owner);
  assert.notEqual(comparableBookingPaymentPhone(owner), comparableBookingPaymentPhone(other));
  assert.notEqual(comparableBookingPaymentPhone(owner), comparableBookingPaymentPhone(""));
});

test("existing Portuguese phone formats still match", () => {
  assert.equal(comparableBookingPaymentPhone("912 345 678"), comparableBookingPaymentPhone("+351 912 345 678"));
  assert.equal(comparableBookingPaymentPhone("00351 912 345 678"), comparableBookingPaymentPhone("+351 912 345 678"));
});
