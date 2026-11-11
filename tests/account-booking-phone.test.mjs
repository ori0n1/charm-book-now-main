import assert from "node:assert/strict";
import test from "node:test";
import {
  isUsableAccountPhone,
  normalizeAccountBookingPhone,
  readAccountPreferredPhone,
} from "../src/lib/account-booking-phone.ts";

test("a shared phone remains a valid account preference", () => {
  const phone = normalizeAccountBookingPhone("+351 912 345 678");
  assert.equal(phone, "+351 912 345 678");
  assert.equal(isUsableAccountPhone(phone), true);
  assert.equal(readAccountPreferredPhone({ bellza_booking_phone: phone }), phone);
});

test("an internal booking marker cannot become a displayed phone", () => {
  assert.equal(readAccountPreferredPhone({ bellza_booking_phone: "account:abcdefgh" }), "");
  assert.equal(readAccountPreferredPhone({ bellza_booking_phone: "abc" }), "");
});
