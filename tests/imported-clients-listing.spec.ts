import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const clientsPage = readFileSync("src/routes/_authenticated/admin.clientes.tsx", "utf8");

test("clients without appointments are loaded directly and remain searchable", () => {
  expect(clientsPage).toContain('.from("clients")');
  expect(clientsPage).toContain('"id,name,phone,auth_user_id,avatar_url,booking_status,suspended_until,block_reason,date_of_birth"');
  expect(clientsPage).toContain("for (const client of studioClients)");
  expect(clientsPage).toContain('lastService: "Sem marcações"');
  expect(clientsPage).toContain('if (!value) return "Sem visita"');
  expect(clientsPage).toContain("client.name.toLowerCase().includes(term)");
  expect(clientsPage).toContain("cleanPhone(client.phone).includes(cleanPhone(term))");
});
