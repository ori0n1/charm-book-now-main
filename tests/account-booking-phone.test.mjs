import assert from "node:assert/strict";
import test from "node:test";
import {
  addCurrentAccountDisplayPhones,
  isUsableAccountPhone,
  normalizeAccountBookingPhone,
  readAccountPreferredPhone,
} from "../src/lib/account-booking-phone.ts";

test("agenda uses the current account phone for old reservations without changing the stored contact", async () => {
  const old = "+351 911 000 000";
  const current = "+351 922 000 000";
  const rows = [
    { id: "old", clients: { phone: old, auth_user_id: "owner-1" } },
    { id: "new", clients: { phone: "account:owner-1", auth_user_id: "owner-1" } },
    { id: "other", clients: { phone: old, auth_user_id: null } },
  ];
  const lookups = [];
  const displayed = await addCurrentAccountDisplayPhones(rows, async (id) => {
    lookups.push(id);
    return current;
  });
  assert.deepEqual(lookups, ["owner-1"]);
  assert.equal(displayed[0].clients.display_phone, current);
  assert.equal(displayed[1].clients.display_phone, current);
  assert.equal(displayed[2].clients.display_phone, old);
  assert.equal(displayed[0].clients.phone, old);
  assert.equal(rows[0].clients.phone, old);
  assert.equal("auth_user_id" in displayed[0].clients, false);
});

test("a shared phone remains a valid account preference", () => {
  const phone = normalizeAccountBookingPhone("+351 912 345 678");
  assert.equal(phone, "+351 912 345 678");
  assert.equal(isUsableAccountPhone(phone), true);
  assert.equal(readAccountPreferredPhone({ bellza_booking_phone: phone }), phone);
});

test("an old reservation retains its saved phone if the global account no longer exists", async () => {
  const rows = [{ id: "old", clients: { phone: "+351 911 000 000", auth_user_id: "removed-account" } }];
  const displayed = await addCurrentAccountDisplayPhones(rows, async () => "");
  assert.equal(displayed[0].clients.display_phone, "+351 911 000 000");
});

test("an internal booking marker cannot become a displayed phone", () => {
  assert.equal(readAccountPreferredPhone({ bellza_booking_phone: "account:abcdefgh" }), "");
  assert.equal(readAccountPreferredPhone({ bellza_booking_phone: "account:123456789" }), "");
  assert.equal(readAccountPreferredPhone({ bellza_booking_phone: "abc" }), "");
});
