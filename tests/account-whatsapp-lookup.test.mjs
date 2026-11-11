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
  node.name?.text === "resolveAccountMarkerWhatsAppRecipient");
assert.ok(declaration);
const compiled = ts.transpileModule(`export ${declaration.getText(ast)}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", "chooseAccountBookingContactRecipient", compiled)(
  exports, chooseAccountBookingContactRecipient,
);

function syntheticDb({ bookedPhone = "account:marker", authUserId = "account-a", authError = null } = {}) {
  const queries = [];
  const authReads = [];
  const phone = "+351 912 345 678";
  const metadata = authorizeAccountBookingContact({}, "studio-a", phone, "2026-11-11T20:00:00Z");
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
              contact_consent_at: null, contact_consent_version: null },
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
  assert.equal(await exports.resolveAccountMarkerWhatsAppRecipient(h.db, ctx), h.phone);
  assert.deepEqual(h.authReads, ["account-a"]);
  assert.deepEqual(h.queries.map((query) => query.table), ["appointments", "clients", "clients"]);
  assert.ok(h.queries.every((query) => query.filters.some(([key, value]) =>
    key === "studio_id" && value === "studio-a")));
  assert.ok(h.queries[2].filters.some(([key, value]) =>
    key === "auth_user_id" && value === "account-a"));
});

test("a changed appointment client or failed account read cannot supply a phone", async () => {
  const mismatch = syntheticDb({ bookedPhone: "account:different" });
  assert.equal(await exports.resolveAccountMarkerWhatsAppRecipient(mismatch.db, ctx), null);
  assert.deepEqual(mismatch.authReads, []);
  const unavailable = syntheticDb({ authError: new Error("unavailable") });
  assert.equal(await exports.resolveAccountMarkerWhatsAppRecipient(unavailable.db, ctx), null);
});
