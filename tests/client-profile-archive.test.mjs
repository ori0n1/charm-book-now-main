import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveClientForOwner, archiveClientInput } from "../src/lib/client-profile-core.ts";

const studioId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const input = { studioId, clientId, confirmation: "EXCLUIR" };

function database(roleRow) {
  const calls = [];
  const chain = {
    select() { return this; },
    eq(field, value) { calls.push([field, value]); return this; },
    limit() { return this; },
    async maybeSingle() { return { data: roleRow, error: null }; },
  };
  return { calls, from(table) { assert.equal(table, "user_roles"); return chain; },
    async rpc(name, args) { calls.push([name, args]); return { error: null }; } };
}

test("exclusão exige confirmação literal", () => {
  assert.equal(archiveClientInput.safeParse({ ...input, confirmation: "sim" }).success, false);
});

test("gestor ou profissional não chega à RPC de exclusão", async () => {
  const db = database(null);
  await assert.rejects(archiveClientForOwner(db, "manager-user", input), { status: 403 });
  assert.equal(db.calls.some(([name]) => name === "archive_client_for_owner"), false);
});

test("proprietário do outro estúdio não chega à RPC", async () => {
  const db = database(null);
  await assert.rejects(archiveClientForOwner(db, "other-owner", input), { status: 403 });
  assert.deepEqual(db.calls.filter(([name]) => name === "studio_id"), [["studio_id", studioId]]);
});

test("proprietário autorizado envia apenas IDs e confirmação à RPC", async () => {
  const db = database({ user_id: "owner" });
  assert.deepEqual(await archiveClientForOwner(db, "owner", input), { archived: true });
  assert.deepEqual(db.calls.at(-1), ["archive_client_for_owner", {
    p_studio_id: studioId, p_client_id: clientId, p_confirmation: "EXCLUIR",
  }]);
});
