import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ledgerExports = {};
vm.runInNewContext(transpile(read("../src/lib/financial-ledger.ts")), { exports: ledgerExports });

const presentationExports = {};
vm.runInNewContext(transpile(read("../src/lib/agenda-payment-presentation.ts")
  .replace('import { fromCents, toCents } from "@/lib/financial-ledger";',
    "const { fromCents, toCents } = globalThis.financialLedger;")), {
  exports: presentationExports,
  financialLedger: ledgerExports,
});

const agenda = read("../src/routes/_authenticated/admin.agenda.tsx");
const attributionSource = agenda.slice(
  agenda.indexOf("function paymentAttribution("),
  agenda.indexOf("function studioPaymentErrorMessage("),
);
const attributionContext = { buildAppointmentPaymentFacts: ledgerExports.buildAppointmentPaymentFacts };
vm.runInNewContext(transpile(`${attributionSource}\nglobalThis.paymentAttribution = paymentAttribution;`), attributionContext);

test("drawer shows net paid, partial balance and pending state", () => {
  const present = presentationExports.buildAgendaModalPaymentPresentation;
  const pending = present(0, 100);
  assert.equal(pending.stateLabel, "Pendente");
  assert.deepEqual(Array.from(pending.items, (item) => [item.label, item.value]),
    [["Pago", 0], ["Restante", 100], ["Total", 100]]);

  const partial = present(30, 100);
  assert.equal(partial.stateLabel, "Parcial");
  assert.deepEqual(Array.from(partial.items, (item) => [item.label, item.value]),
    [["Pago", 30], ["Restante", 70], ["Total", 100]]);

  const paid = present(100, 100);
  assert.equal(paid.stateLabel, "Pago");
  assert.deepEqual(Array.from(paid.items, (item) => [item.label, item.value]),
    [["Pago", 100], ["Total", 100]]);
});

test("local Stripe confirmation requires a succeeded payment intent identifier", () => {
  const rows = [
    { id: "a", status: "succeeded", stripe_payment_intent_id: "pi_123" },
    { id: "b", status: "succeeded", stripe_payment_intent_id: null },
    { id: "c", status: "processing", stripe_payment_intent_id: "pi_456" },
    { id: "d", status: "succeeded", stripe_payment_intent_id: "invalid" },
  ];
  assert.deepEqual(Array.from(presentationExports.confirmedStripePaymentRows(rows), (row) => row.id), ["a"]);
});

test("only confirmed, linked and still received Stripe methods are shown", () => {
  const online = [
    { id: "pi-card", appointment_id: "appt-a", amount_cents: 10000, status: "succeeded", method: "card" },
    { id: "pi-mb", appointment_id: "appt-a", amount_cents: 2000, status: "processing", method: "mb_way" },
    { id: "pi-other", appointment_id: "appt-b", amount_cents: 5000, status: "succeeded", method: "mb_way" },
  ];
  const refund = [{ id: "refund-a", appointment_id: "appt-a", payment_intent_id: "pi-card", amount_cents: 4000, status: "refunded" }];
  const paid = ledgerExports.buildAppointmentPaymentFacts(online, [], refund).get("appt-a");
  assert.equal(paid.receivedCents, 6000);
  assert.equal(presentationExports.buildAgendaModalPaymentPresentation(paid.receivedCents / 100, 100).stateLabel, "Parcial");
  assert.deepEqual(Array.from(attributionContext.paymentAttribution("appt-a", online, [], refund)), ["Cartão"]);

  const fullRefund = [{ ...refund[0], amount_cents: 10000 }];
  assert.equal(ledgerExports.buildAppointmentPaymentFacts(online, [], fullRefund).get("appt-a").receivedCents, 0);
  assert.deepEqual(Array.from(attributionContext.paymentAttribution("appt-a", online, [], fullRefund)), []);
});

test("lost disputes and other appointments cannot create a paid method", () => {
  const online = [{ id: "pi-disputed", appointment_id: "appt-a", amount_cents: 5000,
    status: "succeeded", method: "mb_way", dispute_status: "lost", disputed_amount_cents: 5000 }];
  assert.equal(ledgerExports.buildAppointmentPaymentFacts(online, [], []).get("appt-a").receivedCents, 0);
  assert.deepEqual(Array.from(attributionContext.paymentAttribution("appt-a", online, [], [])), []);
  assert.deepEqual(Array.from(attributionContext.paymentAttribution("appt-b", online, [], [])), []);
});
