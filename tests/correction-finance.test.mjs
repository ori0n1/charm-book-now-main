import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildAppointmentPaymentFacts, computeAppointmentLedger } from "../src/lib/financial-ledger.ts";

test("cancelamento retira receita e valor a receber sem apagar dinheiro real", () => {
  const facts = buildAppointmentPaymentFacts(
    [{ id: "pi-1", appointment_id: "a1", amount_cents: 3000, status: "succeeded" }],
    [{ id: "m1", appointment_id: "a1", amount: 20, movement_type: "service_payment" }],
  ).get("a1");
  assert.ok(facts);
  const cancelled = computeAppointmentLedger("a1", 100, "cancelled", facts);
  assert.equal(cancelled.realizedCents, 0);
  assert.equal(cancelled.pendingCents, 0);
  assert.equal(cancelled.receivedCents, 5000);
  const reopened = computeAppointmentLedger("a1", 100, "confirmed", facts);
  assert.equal(reopened.pendingCents, 5000);
  const completed = computeAppointmentLedger("a1", 100, "completed", facts);
  assert.equal(completed.realizedCents, 10000);
  assert.equal(completed.receivedCents, 5000);
});

test("caixa exclui o serviço cancelado mesmo se o registo antigo não tiver cancelled_at", () => {
  const source = readFileSync("src/routes/_authenticated/admin.balcao.tsx", "utf8");
  const fragment = source.slice(source.indexOf("function isVoidedServiceMovement("), source.indexOf("function CancellationAudit("));
  const context = vm.createContext({ isOutgoingMovement: (type) => ["manual_out", "sangria", "transfer_out"].includes(type) });
  vm.runInContext(ts.transpile(fragment + "\nglobalThis.cash = { effectiveServiceRevenue, effectiveCashIncome, effectiveCashBalance };", {
    target: ts.ScriptTarget.ES2022,
  }), context);
  const movements = [
    { movement_type: "service_payment", appointment_status: "cancelled", amount: 40, cancelled_at: null },
    { movement_type: "service_payment", appointment_status: "completed", amount: 15 },
    { movement_type: "manual_out", amount: 5 },
  ];
  assert.equal(context.cash.effectiveServiceRevenue(movements), 15);
  assert.equal(context.cash.effectiveCashIncome(movements), 15);
  assert.equal(context.cash.effectiveCashBalance(10, movements), 20);
});

