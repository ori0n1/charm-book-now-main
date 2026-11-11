import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { chooseAccountBookingContactRecipient, authorizeAccountBookingContact } from "../src/lib/account-booking-phone.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/lib/whatsapp.functions.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("whatsapp.functions.ts", source, ts.ScriptTarget.ES2022, true);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) &&
  node.name?.text === "resolveAppointmentWhatsAppRecipient");
assert.ok(declaration);
const compiled = ts.transpileModule(`export ${declaration.getText(ast)}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", "chooseAccountBookingContactRecipient", compiled)(
  exports, chooseAccountBookingContactRecipient,
);

function syntheticDb({ bookedPhone = "account:marker", authUserId = "account-a",
  authError = null, metadata: suppliedMetadata = null, consentedRow = false } = {}) {
  const queries = [];
  const authReads = [];
  const phone = "+351 912 345 678";
  const metadata = suppliedMetadata ?? authorizeAccountBookingContact(
    {}, "studio-a", phone, "2026-11-11T20:00:00Z",
  );
  const db = {
    auth: { admin: { getUserById: async (id) => {
      authReads.push(id);
      return { data: { user: { id, user_metadata: metadata } }, error: authError };
    } } },
    from(table) {
      const query = { table, selection: "", filters: [] };
      queries.push(query);
      const chain = {
        select(value) { query.selection = value; return chain; },
        eq(key, value) { query.filters.push([key, value]); return chain; },
        is(key, value) { query.filters.push([key, value]); return chain; },
        async maybeSingle() {
          if (table === "appointments") return { data: { client_id: "client-a" }, error: null };
          return { data: { auth_user_id: authUserId, phone: bookedPhone }, error: null };
        },
        then(resolve) {
          return Promise.resolve({ data: [
            { studio_id: "studio-a", auth_user_id: authUserId, phone: bookedPhone,
              contact_consent_at: consentedRow ? "2026-11-11T19:00:00Z" : null,
              contact_consent_version: consentedRow ? "booking-v1" : null },
          ], error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
  return { db, queries, authReads, phone };
}

const ctx = { appointmentId: "appointment-a", studioId: "studio-a", clientPhone: "account:marker" };

test("marker lookup reads only the appointment owner in the same studio", async () => {
  const h = syntheticDb();
  assert.deepEqual(await exports.resolveAppointmentWhatsAppRecipient(h.db, ctx),
    { accountOwned: true, phone: h.phone });
  assert.deepEqual(h.authReads, ["account-a"]);
  assert.deepEqual(h.queries.map((query) => query.table), ["appointments", "clients", "clients"]);
  assert.ok(h.queries.every((query) => query.filters.some(([key, value]) =>
    key === "studio_id" && value === "studio-a")));
  assert.ok(h.queries[2].filters.some(([key, value]) =>
    key === "auth_user_id" && value === "account-a"));
});

test("a changed appointment client or failed account read cannot supply a phone", async () => {
  const mismatch = syntheticDb({ bookedPhone: "account:different" });
  assert.deepEqual(await exports.resolveAppointmentWhatsAppRecipient(mismatch.db, ctx),
    { accountOwned: true, phone: null });
  assert.deepEqual(mismatch.authReads, []);
  const unavailable = syntheticDb({ authError: new Error("unavailable") });
  assert.deepEqual(await exports.resolveAppointmentWhatsAppRecipient(unavailable.db, ctx),
    { accountOwned: true, phone: null });
});

test("an older appointment with a normal phone uses the account's current phone", async () => {
  const oldPhone = "+351 911 111 111";
  const h = syntheticDb({ bookedPhone: oldPhone, consentedRow: true });
  assert.deepEqual(await exports.resolveAppointmentWhatsAppRecipient(h.db,
    { ...ctx, clientPhone: oldPhone }), { accountOwned: true, phone: h.phone });
  assert.deepEqual(h.authReads, ["account-a"]);
});

test("an older appointment cannot reuse its former number without current authorization", async () => {
  const oldPhone = "+351 911 111 111";
  const h = syntheticDb({ bookedPhone: oldPhone, consentedRow: true,
    metadata: { bellza_booking_phone: "+351 912 345 678",
      bellza_booking_phone_revision: "new-phone-revision" } });
  assert.deepEqual(await exports.resolveAppointmentWhatsAppRecipient(h.db,
    { ...ctx, clientPhone: oldPhone }), { accountOwned: true, phone: null });
});

test("unlinked appointments keep their existing phone path", async () => {
  const oldPhone = "+351 911 111 111";
  const h = syntheticDb({ bookedPhone: oldPhone, authUserId: null });
  assert.deepEqual(await exports.resolveAppointmentWhatsAppRecipient(h.db,
    { ...ctx, clientPhone: oldPhone }), { accountOwned: false, phone: oldPhone });
  assert.deepEqual(h.authReads, []);
});
