import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const clientsPage = readFileSync("src/routes/_authenticated/admin.clientes.tsx", "utf8");
const riskEngine = readFileSync("src/lib/client-risk.ts", "utf8");

test("client cards explain a delayed return without the ambiguous risk label", () => {
  expect(clientsPage).toContain('const CLIENT_WITHOUT_RETURN_BADGE = "Cliente sem retornar"');
  expect(clientsPage).toContain("`Não retorna há ${daysSinceLastVisit} dia");
  expect(clientsPage).not.toContain('label: "Cliente em risco"');
  expect(clientsPage).not.toContain('label: "Em risco"');
});

test("client details state the reason, elapsed days and expected date", () => {
  expect(clientsPage).toContain('hasDelayedReturn ? "Cliente com retorno atrasado"');
  expect(clientsPage).toContain("Não retorna há {client.daysSinceLastVisit} dia");
  expect(clientsPage).toContain("Pelo histórico de visitas, o");
  expect(clientsPage).toContain("retorno era esperado em {formatDate(client.suggestedReturnAt)}");
});

test("communication change preserves cadence, safety margin and future-booking criteria", () => {
  expect(riskEngine).toContain(
    "if (hasFutureBooking || averageIntervalDays === null || daysSinceLastVisit === null) return false",
  );
  expect(riskEngine).toContain(
    "const safetyDays = Math.max(7, Math.round(averageIntervalDays * 0.35))",
  );
  expect(riskEngine).toContain("return daysSinceLastVisit > averageIntervalDays + safetyDays");
  expect(clientsPage).toContain("isClientAtRiskByCadence({");
});

test("compact card keeps the status inline instead of adding another card row", () => {
  expect(clientsPage).toContain("<ClientPrimaryStatus client={client} compact />");
  expect(clientsPage).toContain('className="mt-0.5 flex min-w-0 items-center gap-1.5"');
});
