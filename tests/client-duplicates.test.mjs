import assert from "node:assert/strict";
import { test } from "node:test";
import { groupDuplicateClients, normalizedClientEmail, normalizedClientPhone } from "../src/lib/client-duplicates.ts";

const studioId = "studio-a";
const makeClient = (id, changes = {}) => ({
  id, studioId, name: "Ana Silva", email: null, phone: "", authUserId: null,
  totalAppointments: 0, completedAppointments: 0, createdAt: "2026-01-01", ...changes,
});

test("normalizes email and Portuguese phone with country code", () => {
  assert.equal(normalizedClientEmail(" Ana@Example.COM "), "ana@example.com");
  assert.equal(normalizedClientPhone("912 345 678"), normalizedClientPhone("00351 912 345 678"));
  assert.equal(normalizedClientPhone("+351 912 345 678"), normalizedClientPhone("912345678"));
});

test("same name alone and same contact in another studio do not group", () => {
  const grouped = groupDuplicateClients([
    makeClient("a", { email: "ana@example.com" }),
    makeClient("b", { email: "other@example.com" }),
    makeClient("c", { studioId: "studio-b", email: "ana@example.com" }),
  ]);
  assert.equal(grouped.length, 0);
});

test("review group favors authenticated history, without treating unverified email as confirmed", () => {
  const groups = groupDuplicateClients([
    makeClient("imported", { email: " Ana@Example.COM ", phone: "912 345 678", createdAt: "2025-01-01" }),
    makeClient("account", { email: "ana@example.com", phone: "+351912345678", authUserId: "user-1", totalAppointments: 4, completedAppointments: 2, createdAt: "2026-01-01" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "possible");
  assert.equal(groups[0].primary.id, "account");
  assert.deepEqual(groups[0].reasons, ["e-mail igual", "telefone equivalente", "nome semelhante"]);
});

test("shared authenticated identity is confirmed", () => {
  const groups = groupDuplicateClients([
    makeClient("old", { authUserId: "user-1" }),
    makeClient("new", { authUserId: "user-1" }),
  ]);
  assert.equal(groups[0].kind, "confirmed");
});
