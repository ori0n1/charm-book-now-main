import assert from "node:assert/strict";
import test from "node:test";
import { clientProfileInput, getClientProfilePermissions, updateClientProfileForMember } from "../src/lib/client-profile-core.ts";

const studioA = "11111111-1111-4111-8111-111111111111";
const studioB = "22222222-2222-4222-8222-222222222222";
const clientA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fixture() {
  const rows = {
    user_roles: [
      { user_id: "owner", studio_id: studioA, role: "studio_owner" },
      { user_id: "manager", studio_id: studioA, role: "manager" },
      { user_id: "professional", studio_id: studioA, role: "staff" },
      { user_id: "desk", studio_id: studioA, role: "desk_staff" },
      { user_id: "other-owner", studio_id: studioB, role: "studio_owner" },
    ],
    clients: [
      { id: clientA, studio_id: studioA, archived_at: null, name: "Ana", phone: "910000001", email: null, notes: null, date_of_birth: null, total_visits: 3 },
      { id: clientB, studio_id: studioB, archived_at: null, name: "Bia", phone: "910000002", email: null, notes: null, date_of_birth: null, total_visits: 2 },
    ],
  };
  const updates = [];
  const db = {
    from(table) {
      const filters = [];
      let patch;
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        is(column, value) { filters.push([column, value]); return query; },
        limit() { return query; },
        update(value) { patch = value; return query; },
        async maybeSingle() {
          const row = rows[table].find((item) => filters.every(([key, value]) => item[key] === value));
          if (!row) return { data: null, error: null };
          if (patch) {
            updates.push({ table, filters: [...filters], patch });
            Object.assign(row, patch);
          }
          return { data: structuredClone(row), error: null };
        },
      };
      return query;
    },
  };
  return { db, rows, updates };
}

function profile(overrides = {}) {
  return clientProfileInput.parse({
    studioId: studioA, clientId: clientA, name: "Ana Corrigida", phone: "910000099",
    email: "ana@example.test", notes: "Nota corrigida", dateOfBirth: "1990-04-12", ...overrides,
  });
}

test("all studio roles can edit the profile, while removal remains owner only", async () => {
  const { db } = fixture();
  for (const userId of ["owner", "manager", "professional", "desk"]) {
    assert.deepEqual(await getClientProfilePermissions(db, userId, studioA), {
      canEdit: true,
      canRemove: userId === "owner",
    });
  }
  assert.deepEqual(await getClientProfilePermissions(db, "other-owner", studioA), { canEdit: false, canRemove: false });
});

test("professionals update only profile fields in their studio; history stays intact", async () => {
  for (const userId of ["owner", "manager", "professional", "desk"]) {
    const state = fixture();
    await updateClientProfileForMember(state.db, userId, profile());
    assert.equal(state.rows.clients[0].name, "Ana Corrigida");
    assert.equal(state.rows.clients[0].total_visits, 3);
    assert.equal(state.rows.clients[1].name, "Bia");
    assert.deepEqual(Object.keys(state.updates[0].patch).sort(), ["date_of_birth", "email", "name", "notes", "phone"]);
    assert.deepEqual(state.updates[0].filters, [["id", clientA], ["studio_id", studioA], ["archived_at", null]]);
  }
});

test("outsiders, other studios, archived clients and extra fields are rejected", async () => {
  const state = fixture();
  await assert.rejects(updateClientProfileForMember(state.db, "outsider", profile()), { status: 403 });
  await assert.rejects(updateClientProfileForMember(state.db, "other-owner", profile()), { status: 403 });
  await assert.rejects(updateClientProfileForMember(state.db, "professional", profile({ clientId: clientB })), { status: 404 });
  state.rows.clients[0].archived_at = "2026-11-01T00:00:00Z";
  await assert.rejects(updateClientProfileForMember(state.db, "professional", profile()), { status: 404 });
  assert.throws(() => profile({ total_visits: 99 }));
  assert.equal(state.updates.length, 0);
});
