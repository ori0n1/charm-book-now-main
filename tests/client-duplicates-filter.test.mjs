import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupDuplicateClients } from "../src/lib/client-duplicates.ts";

const client = (id, extra = {}) => ({
  id, studioId: "studio-test", createdAt: "2026-01-01", name: `Cliente ${id}`, email: null, phone: "", authUserId: null,
  totalAppointments: 0, completedAppointments: 0, ...extra,
});

test("o filtro identifica contactos equivalentes e sugere o registo com histórico", () => {
  const groups = groupDuplicateClients([
    client("a", { name: "Ana", phone: "912 345 678", totalAppointments: 1 }),
    client("b", { name: "Ana", phone: "+351 912 345 678", totalAppointments: 4 }),
    client("c", { name: "Ana", phone: "", email: null }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].clients.map(({ id }) => id), ["b", "a"]);
  assert.equal(groups[0].kind, "possible");
  assert.ok(groups[0].reasons.includes("telefone equivalente"));
});

test("a mesma conta autentificada confirma a duplicidade; nomes iguais isolados não bastam", () => {
  const groups = groupDuplicateClients([
    client("a", { name: "João", authUserId: "user-1" }),
    client("b", { name: "João", authUserId: "user-1" }),
    client("c", { name: "João" }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].clients.map(({ id }) => id), ["a", "b"]);
  assert.equal(groups[0].kind, "confirmed");
});

test("contrato de publicação preserva filtros funcionais na página de Clientes", () => {
  const route = readFileSync(new URL("../src/routes/_authenticated/admin.clientes.tsx", import.meta.url), "utf8");
  for (const feature of ["Filtrar clientes", "Possíveis duplicados", "groupDuplicateClients", "Filtrar mensagens", "Ordenar clientes", "ClientDesktopTable", "ClientCompactCard", "Selecionar clientes", "ClientReviewList", "removeClientProfiles", "unifyEmptyClientProfiles"]) {
    assert.ok(route.includes(feature), `Funcionalidade removida da página de Clientes: ${feature}`);
  }
  const core = readFileSync(new URL("../src/lib/client-profile-core.ts", import.meta.url), "utf8");
  for (const rpc of ["client_dependency_counts", "delete_clients_for_owner", "unify_empty_client_for_owner"]) {
    assert.ok(core.includes(rpc), `RPC de duplicados removida do servidor: ${rpc}`);
  }
});
