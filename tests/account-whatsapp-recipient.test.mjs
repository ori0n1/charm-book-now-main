import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeAccountBookingContact,
  changeAccountBookingPhone,
  chooseAccountBookingContactRecipient,
  hasAccountBookingContactAuthorization,
} from "../src/lib/account-booking-phone.ts";

const studioId = "studio-a";
const authUserId = "account-a";
const phone = "+351 912 345 678";
const acceptedAt = "2026-11-11T20:00:00.000Z";
const row = (overrides = {}) => ({
  studio_id: studioId,
  auth_user_id: authUserId,
  phone,
  contact_consent_at: acceptedAt,
  contact_consent_version: "booking-v1",
  ...overrides,
});
const choose = (metadata, ownedClients = []) => chooseAccountBookingContactRecipient({
  studioId, authUserId, metadata, ownedClients,
});

test("an authorized account contact wins over an unlinked historical duplicate", () => {
  const metadata = authorizeAccountBookingContact({}, studioId, phone, acceptedAt);
  assert.equal(choose(metadata, [row({ auth_user_id: null, phone }),
    row({ auth_user_id: "account-b", phone })]), phone);
  assert.equal(hasAccountBookingContactAuthorization(metadata, studioId, phone), true);
});

test("another account and another studio cannot supply the recipient", () => {
  assert.equal(choose({}, [row({ auth_user_id: "account-b" })]), null);
  assert.equal(choose({}, [row({ studio_id: "studio-b" })]), null);
  assert.equal(choose({}, [row({ phone: "account:marker" })]), null);
});

test("a previously consented phone on this account remains eligible", () => {
  assert.equal(choose({ bellza_booking_phone: "+351912345678" }, [row()]), "+351912345678");
  assert.equal(choose({}, [row()]), phone);
});

test("missing consent, stale consent, and invalid numbers fail closed", () => {
  assert.equal(choose({ bellza_booking_phone: phone }), null);
  assert.equal(choose({ bellza_booking_phone: phone }, [row({ contact_consent_at: null })]), null);
  assert.equal(choose({ bellza_booking_phone: phone }, [row({ contact_consent_version: "old" })]), null);
  assert.equal(choose({ bellza_booking_phone: "abc" }, [row({ phone: "abc" })]), null);
  const stale = authorizeAccountBookingContact({}, studioId, phone, acceptedAt);
  assert.equal(choose(stale, [row({ phone: "+351 900 000 000" })]), phone);
  assert.equal(choose({ ...stale, bellza_booking_phone: "+351 900 000 000" }), null);
});

test("editing the number clears its authorization without claiming verification", () => {
  const first = authorizeAccountBookingContact({ provider: "google" }, studioId, phone, acceptedAt);
  const initial = authorizeAccountBookingContact(first, "studio-b", phone, acceptedAt);
  const changed = changeAccountBookingPhone(initial, "+351 900 000 000");
  assert.equal(changed.provider, "google");
  assert.equal(choose(changed, [row()]), null);
  assert.equal(hasAccountBookingContactAuthorization(changed, studioId, phone), false);
  assert.equal(hasAccountBookingContactAuthorization(changed, "studio-b", phone), false);
  const authorizedNew = authorizeAccountBookingContact(changed, studioId, "+351 900 000 000", acceptedAt);
  assert.equal(choose(authorizedNew, [row()]), "+351 900 000 000");
  const reverted = changeAccountBookingPhone(authorizedNew, phone);
  assert.equal(choose(reverted, [row()]), null);
});

test("conflicting consented account numbers do not select a recipient", () => {
  assert.equal(choose({}, [row(), row({ phone: "+351 900 000 000" })]), null);
});
