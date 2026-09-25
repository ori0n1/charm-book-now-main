import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { buildAppointmentPaymentFacts } from "../src/lib/financial-ledger";
import { buildFinancialReport, type FinancialReportAppointment } from "../src/lib/financial-report";
import { resolveFinancialReportPeriod } from "../src/lib/financial-report.functions";

const period = {
  staffId: null,
  paymentMethod: null,
  source: "all" as const,
  startsAtInclusive: "2026-09-01T00:00:00.000Z",
  endsAtExclusive: "2026-10-01T00:00:00.000Z",
};

const financialRuntimeSources = Promise.all([
  readFile("src/lib/financial-report.functions.ts", "utf8"),
  readFile("src/routes/_authenticated/admin.index.tsx", "utf8"),
  readFile("src/routes/_authenticated/admin.equipa.tsx", "utf8"),
  readFile("src/lib/refund-operations.functions.ts", "utf8"),
  readFile("src/routes/api/public/payments/webhook.ts", "utf8"),
  readFile("src/lib/stripe-connect.functions.ts", "utf8"),
]);

function appointment(
  id: string,
  staffId: string,
  total: number,
  status: string,
  startsAt = "2026-09-10T10:00:00.000Z",
): FinancialReportAppointment {
  return { id, staff_id: staffId, total_price: total, status, starts_at: startsAt };
}

function fixture() {
  const appointments = [
    appointment("future-paid", "s1", 100, "confirmed", "2026-09-25T10:00:00.000Z"),
    appointment("completed-unpaid", "s1", 80, "completed"),
    appointment("completed-split", "s2", 100, "completed"),
    appointment("cancelled-unpaid", "s1", 60, "cancelled"),
    appointment("cancelled-deposit", "s1", 50, "cancelled"),
    appointment("no-show-deposit", "s2", 40, "no_show"),
  ];
  const onlinePayments = [
    { id: "pi-future", appointment_id: "future-paid", amount_cents: 10_000, status: "succeeded", method: "mb_way" },
    { id: "pi-split", appointment_id: "completed-split", amount_cents: 3_000, status: "succeeded", method: "mb_way" },
    { id: "pi-cancelled", appointment_id: "cancelled-deposit", amount_cents: 2_000, status: "succeeded", method: "multibanco" },
    { id: "pi-no-show", appointment_id: "no-show-deposit", amount_cents: 1_000, status: "succeeded", method: "mb_way" },
  ];
  const onsitePayments = [
    { id: "cash-split", appointment_id: "completed-split", amount: 70, movement_type: "service_payment", payment_method: "cash" },
  ];
  const manualEntries = [
    { id: "manual-1", staff_id: "s1", performed_at: "2026-09-11T10:00:00.000Z", amount: 25, payment_method: "cash", source: "manual" as const, serviceName: "Corte", staffName: "Ana" },
    { id: "walk-1", staff_id: "s2", performed_at: "2026-09-12T10:00:00.000Z", amount: 30, payment_method: "card", source: "walk_in" as const, serviceName: "Unhas", staffName: "Paula" },
  ];
  return {
    appointments,
    onlinePayments,
    onsitePayments,
    refunds: [],
    manualEntries,
    staff: [{ id: "s1", name: "Ana" }, { id: "s2", name: "Paula" }],
    studioCommissionPercent: 30,
  };
}

test("KPI, composição e profissionais reconciliam no mesmo universo", () => {
  const report = buildFinancialReport({ ...fixture(), filters: period });
  expect(report.summary).toMatchObject({
    scheduledCents: 28_000,
    realizedCents: 23_500,
    receivedOnlineCents: 16_000,
    receivedOnsiteCents: 12_500,
    receivedCents: 28_500,
    pendingCents: 8_000,
    lostRevenueCents: 3_000,
  });
  expect(report.summary.receivedCents).toBe(
    report.summary.receivedOnlineCents + report.summary.receivedOnsiteCents,
  );
  expect(report.byStaff.reduce((sum, member) => sum + member.receivedCents, 0)).toBe(
    report.summary.receivedCents,
  );
  expect(report.reconciliation).toEqual({
    receivedComponentsMatch: true,
    staffReceivedMatches: true,
  });
});

test("futuro pago é recebido, mas nunca receita realizada", () => {
  const data = fixture();
  const report = buildFinancialReport({
    ...data,
    appointments: data.appointments.filter((row) => row.id === "future-paid"),
    onlinePayments: data.onlinePayments.filter((row) => row.appointment_id === "future-paid"),
    onsitePayments: [],
    manualEntries: [],
    filters: period,
  });
  expect(report.summary.receivedCents).toBe(10_000);
  expect(report.summary.realizedCents).toBe(0);
  expect(report.summary.pendingCents).toBe(0);
});

test("concluída não paga realiza serviço e continua a receber", () => {
  const data = fixture();
  const report = buildFinancialReport({
    ...data,
    appointments: data.appointments.filter((row) => row.id === "completed-unpaid"),
    onlinePayments: [],
    onsitePayments: [],
    manualEntries: [],
    filters: period,
  });
  expect(report.summary.realizedCents).toBe(8_000);
  expect(report.summary.receivedCents).toBe(0);
  expect(report.summary.pendingCents).toBe(8_000);
});

test("cancelamento e falta não realizam receita nem criam pendente, mas preservam sinal retido", () => {
  const data = fixture();
  const selectedIds = new Set(["cancelled-unpaid", "cancelled-deposit", "no-show-deposit"]);
  const report = buildFinancialReport({
    ...data,
    appointments: data.appointments.filter((row) => selectedIds.has(row.id)),
    onlinePayments: data.onlinePayments.filter((row) => selectedIds.has(String(row.appointment_id))),
    onsitePayments: [],
    manualEntries: [],
    filters: period,
  });
  expect(report.summary.realizedCents).toBe(0);
  expect(report.summary.pendingCents).toBe(0);
  expect(report.summary.receivedCents).toBe(3_000);
  expect(report.summary.lostRevenueCents).toBe(3_000);
});

test("reembolso parcial e total abatem somente o dinheiro realmente reembolsado", () => {
  const partial = buildAppointmentPaymentFacts(
    [{ id: "pi", appointment_id: "a", amount_cents: 10_000, status: "succeeded" }],
    [],
    [{ id: "rr-part", appointment_id: "a", payment_intent_id: "pi", amount_cents: 2_500, status: "refunded", payment_intents: { amount_cents: 10_000 } }],
  ).get("a");
  expect(partial).toMatchObject({ onlineNetCents: 7_500, refundedCents: 2_500, receivedCents: 7_500 });

  const lostDispute = buildAppointmentPaymentFacts(
    [{ id: "pi", appointment_id: "a", amount_cents: 10_000, status: "succeeded", dispute_status: "lost", disputed_amount_cents: 4_000 }],
    [],
    [],
  ).get("a");
  expect(lostDispute).toMatchObject({
    onlineGrossCents: 10_000,
    disputedLostCents: 4_000,
    onlineNetCents: 6_000,
    receivedCents: 6_000,
  });

  const duplicateFull = buildAppointmentPaymentFacts(
    [{ id: "pi", appointment_id: "a", amount_cents: 10_000, status: "succeeded" }],
    [],
    [
      { id: "rr-1", appointment_id: "a", payment_intent_id: "pi", status: "refunded", payment_intents: { amount_cents: 10_000 } },
      { id: "rr-2", appointment_id: "a", payment_intent_id: "pi", status: "refunded", payment_intents: { amount_cents: 10_000 } },
    ],
  ).get("a");
  expect(duplicateFull).toMatchObject({ onlineNetCents: 0, refundedCents: 10_000, receivedCents: 0 });

  const duplicateOneOfTwoPayments = buildAppointmentPaymentFacts(
    [
      { id: "pi-a", appointment_id: "a", amount_cents: 5_000, status: "succeeded" },
      { id: "pi-b", appointment_id: "a", amount_cents: 5_000, status: "succeeded" },
    ],
    [],
    [
      { id: "rr-a-1", appointment_id: "a", payment_intent_id: "pi-a", status: "refunded", payment_intents: { amount_cents: 5_000 } },
      { id: "rr-a-2", appointment_id: "a", payment_intent_id: "pi-a", status: "refunded", payment_intents: { amount_cents: 5_000 } },
    ],
  ).get("a");
  expect(duplicateOneOfTwoPayments).toMatchObject({
    onlineNetCents: 5_000,
    refundedCents: 5_000,
    receivedCents: 5_000,
  });
});

test("forma de pagamento filtra recebido sem falsificar realizado ou pendente", () => {
  const report = buildFinancialReport({
    ...fixture(),
    filters: { ...period, paymentMethod: "cash" },
  });
  expect(report.summary.receivedCents).toBe(9_500);
  expect(report.summary.receivedOnlineCents).toBe(0);
  expect(report.summary.receivedOnsiteCents).toBe(9_500);
  expect(report.summary.realizedCents).toBe(23_500);
  expect(report.summary.pendingCents).toBe(8_000);
  expect(report.manualEntries.map((entry) => entry.id)).toEqual(["manual-1"]);
});

test("filtros por profissional, tipo e período são determinísticos", () => {
  const data = fixture();
  const ana = buildFinancialReport({ ...data, filters: { ...period, staffId: "s1" } });
  expect(ana.byStaff).toHaveLength(1);
  expect(ana.byStaff[0].name).toBe("Ana");

  const walkIn = buildFinancialReport({ ...data, filters: { ...period, source: "walk_in" } });
  expect(walkIn.summary).toMatchObject({ realizedCents: 3_000, receivedCents: 3_000 });

  const movedOutside = buildFinancialReport({
    ...data,
    appointments: data.appointments.map((row) =>
      row.id === "completed-split" ? { ...row, starts_at: "2026-10-01T00:00:00.000Z", staff_id: "s1" } : row,
    ),
    filters: period,
  });
  expect(movedOutside.summary.realizedCents).toBe(13_500);
  expect(movedOutside.summary.receivedCents).toBe(18_500);
});

test("limites do mês respeitam o fuso Europe/Lisbon", () => {
  const resolved = resolveFinancialReportPeriod(
    { period: "this_month", startDate: null, endDate: null },
    "Europe/Lisbon",
    new Date("2026-09-11T12:00:00.000Z"),
  );
  expect(resolved).toMatchObject({
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    startsAtInclusive: "2026-08-31T23:00:00.000Z",
    endsAtExclusive: "2026-09-30T23:00:00.000Z",
  });
});

test("API financeira valida tenant e a página não volta a chamar realizado de online", async () => {
  const [server, page] = await Promise.all([
    readFile("src/lib/financial-report.functions.ts", "utf8"),
    readFile("src/routes/_authenticated/admin.pagamentos.tsx", "utf8"),
  ]);
  expect(server).toContain("assertStudioAccessWithOptions");
  expect(server).toContain('entitlement: "finance_basic"');
  expect(server.match(/\.eq\("studio_id", studioId\)/g)?.length).toBeGreaterThanOrEqual(3);
  expect(server).toContain("loadAllPages");
  expect(page).toContain("Recebido por profissional");
  expect(page).not.toContain("Receita por profissional");
  expect(page).toContain("Como funcionam os pagamentos online");
  expect(page).toContain("side=\"bottom\"");
});

test("legacy refund without an optional amount uses the real payment amount", () => {
  const facts = buildAppointmentPaymentFacts(
    [{ id: "pi", appointment_id: "a", amount_cents: 10_000, status: "succeeded" }],
    [],
    [
      {
        id: "rr",
        appointment_id: "a",
        payment_intent_id: "pi",
        status: "refunded",
        payment_intents: { amount_cents: 10_000 },
      },
    ],
  ).get("a");

  expect(facts).toMatchObject({
    onlineGrossCents: 10_000,
    refundedCents: 10_000,
    onlineNetCents: 0,
    receivedCents: 0,
  });
});

test("financial runtime only queries fields present in the production schema", async () => {
  const [report, dashboard, team, refunds, webhook, connect] = await financialRuntimeSources;
  const runtime = [report, dashboard, team, refunds, webhook, connect].join("\n");

  expect(report).toContain('"id,appointment_id,amount_cents,status,method"');
  expect(report).toContain(
    '"id,appointment_id,payment_intent_id,status,payment_intents(amount_cents)"',
  );
  expect(report).toContain('from("financial_audit_logs")');
  expect(report).toContain('.eq("action", "stripe_refund_succeeded")');
  expect(dashboard).toContain('.select("id,appointment_id,amount_cents,status")');
  expect(team).toContain('.select("id,appointment_id,amount_cents,status")');

  expect(runtime).not.toContain(
    'select("id,appointment_id,amount_cents,status,dispute_status,disputed_amount_cents")',
  );
  expect(runtime).not.toContain(
    'select("id,appointment_id,payment_intent_id,amount_cents,status,payment_intents(amount_cents)")',
  );
  expect(refunds).not.toContain("refunded_amount_cents");
  expect(refunds).not.toContain("stripe_last_synced_at");
  expect(webhook).not.toContain("refunded_amount_cents: amountRefunded");
  expect(webhook).not.toMatch(/^\s+refund_status:\s*refundStatus,/m);
  expect(webhook).not.toContain("stripe_financial_state_updated_at:");
  expect(connect).not.toContain("stripe_connect_fees_payer:");
  expect(connect).not.toContain("stripe_connect_negative_balance_cents:");
});
