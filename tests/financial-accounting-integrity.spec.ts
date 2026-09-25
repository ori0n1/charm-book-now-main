import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildAppointmentPaymentFacts,
  computeAppointmentFinancialSplit,
  summarizeFinancialPeriod,
  type PeriodFinancialAppointment,
} from "../src/lib/financial-ledger";

function appointment(
  id: string,
  total: number,
  options: Partial<PeriodFinancialAppointment> = {},
): PeriodFinancialAppointment {
  return {
    id,
    starts_at: "2026-08-20T10:00:00.000Z",
    total_price: total,
    status: "confirmed",
    studio_commission_percent_snapshot: 30,
    appointment_services: [
      { price: total, studio_commission_percent_snapshot: 30 },
    ],
    ...options,
  };
}

function facts(
  online: Parameters<typeof buildAppointmentPaymentFacts>[0] = [],
  onsite: Parameters<typeof buildAppointmentPaymentFacts>[1] = [],
  refunds: Parameters<typeof buildAppointmentPaymentFacts>[2] = [],
) {
  return buildAppointmentPaymentFacts(online, onsite, refunds);
}

test("1. serviço de 100 € divide exatamente 30% estúdio e 70% profissional", () => {
  const appt = appointment("a1", 100, { status: "completed" });
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30);
  expect(split.studio).toBe(30);
  expect(split.professional).toBe(70);
  expect(split.studio + split.professional).toBe(split.total);
});

test("2. pagamento integral online zera o pendente", () => {
  const appt = appointment("a2", 100);
  const paymentFacts = facts([
    { id: "pi-2", appointment_id: appt.id, amount_cents: 10_000, status: "succeeded" },
  ]);
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30, paymentFacts.get(appt.id));
  expect(split.receivedOnline).toBe(100);
  expect(split.receivedOnsite).toBe(0);
  expect(split.pending).toBe(0);
  expect(split.total).toBe(split.received + split.pending);
});

test("3. pagamento presencial conta como recebido e não como online", () => {
  const appt = appointment("a3", 100, { status: "completed" });
  const paymentFacts = facts([], [
    { id: "cash-3", appointment_id: appt.id, amount: 100, movement_type: "service_payment" },
  ]);
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30, paymentFacts.get(appt.id));
  expect(split.receivedOnline).toBe(0);
  expect(split.receivedOnsite).toBe(100);
  expect(split.pending).toBe(0);
});

test("4. sinal online e restante presencial são somados uma única vez", () => {
  const appt = appointment("a4", 100, { status: "completed" });
  const paymentFacts = facts(
    [{ id: "pi-4", appointment_id: appt.id, amount_cents: 3_000, status: "succeeded" }],
    [{ id: "cash-4", appointment_id: appt.id, amount: 70, movement_type: "service_payment" }],
  );
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30, paymentFacts.get(appt.id));
  expect(split.receivedOnline).toBe(30);
  expect(split.receivedOnsite).toBe(70);
  expect(split.received).toBe(100);
  expect(split.pending).toBe(0);
});

test("5. marcação não paga mantém todo o valor por receber", () => {
  const appt = appointment("a5", 100);
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30);
  expect(split.total).toBe(100);
  expect(split.received).toBe(0);
  expect(split.pending).toBe(100);
  expect(split.total).toBe(split.received + split.pending);
});

test("6. cancelamento não entra em agendado nem pendente", () => {
  const appt = appointment("a6", 100, { status: "cancelled" });
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30);
  expect(split.total).toBe(0);
  expect(split.received).toBe(0);
  expect(split.pending).toBe(0);
});

test("7. reembolso concluído retira o pagamento do recebido", () => {
  const appt = appointment("a7", 100, { status: "cancelled" });
  const paymentFacts = facts(
    [{ id: "pi-7", appointment_id: appt.id, amount_cents: 10_000, status: "succeeded" }],
    [],
    [
      {
        id: "rr-7",
        appointment_id: appt.id,
        payment_intent_id: "pi-7",
        status: "refunded",
        payment_intents: { amount_cents: 10_000 },
      },
    ],
  );
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30, paymentFacts.get(appt.id));
  expect(split.refunded).toBe(100);
  expect(split.received).toBe(0);
});

test("8. alteração posterior da comissão não modifica snapshot antigo", () => {
  const appt = appointment("a8", 100, {
    status: "completed",
    studio_commission_percent_snapshot: 30,
    appointment_services: [{ price: 100, studio_commission_percent_snapshot: 30 }],
  });
  const splitAfterLiveRuleChangedTo60 = computeAppointmentFinancialSplit(appt.id, appt, 60);
  expect(splitAfterLiveRuleChangedTo60.studio).toBe(30);
  expect(splitAfterLiveRuleChangedTo60.professional).toBe(70);
});

test("9. vários profissionais respeitam percentuais efetivos diferentes", () => {
  const first = appointment("a9-1", 100, {
    status: "completed",
    studio_commission_percent_snapshot: 20,
    appointment_services: [{ price: 100, studio_commission_percent_snapshot: 20 }],
  });
  const second = appointment("a9-2", 100, {
    status: "completed",
    studio_commission_percent_snapshot: 40,
    appointment_services: [{ price: 100, studio_commission_percent_snapshot: 40 }],
  });
  const period = summarizeFinancialPeriod(
    [first, second],
    new Map(),
    30,
    new Date("2026-08-20T00:00:00Z"),
    new Date("2026-08-21T00:00:00Z"),
  );
  expect(period.studioCents).toBe(6_000);
  expect(period.teamCents).toBe(14_000);
  expect(period.studioCents + period.teamCents).toBe(period.realizedCents);
});

test("10. várias marcações no mesmo dia são somadas sem duplicação", () => {
  const a = appointment("a10-1", 40);
  const b = appointment("a10-2", 60);
  const period = summarizeFinancialPeriod(
    [a, a, b],
    new Map(),
    30,
    new Date("2026-08-20T00:00:00Z"),
    new Date("2026-08-21T00:00:00Z"),
  );
  expect(period.appointmentCount).toBe(2);
  expect(period.scheduledCents).toBe(10_000);
  expect(period.pendingCents).toBe(10_000);
});

test("11. períodos de 7, 15 e 30 dias usam limites inclusivo/exclusivo", () => {
  const end = new Date("2026-08-31T00:00:00Z");
  const rows = [
    appointment("p7", 7, { starts_at: "2026-08-30T10:00:00Z" }),
    appointment("p15", 15, { starts_at: "2026-08-20T10:00:00Z" }),
    appointment("p30", 30, { starts_at: "2026-08-05T10:00:00Z" }),
    appointment("outside", 99, { starts_at: "2026-07-31T23:59:59Z" }),
  ];
  const sum = (days: number) =>
    summarizeFinancialPeriod(
      rows,
      new Map(),
      30,
      new Date(end.getTime() - days * 86_400_000),
      end,
    ).scheduledCents;
  expect(sum(7)).toBe(700);
  expect(sum(15)).toBe(2_200);
  expect(sum(30)).toBe(5_200);
});

test("12. valores com cêntimos reconciliam pelo resto, sem perda", () => {
  const appt = appointment("a12", 10.01, {
    status: "completed",
    appointment_services: [
      { price: 3.33, studio_commission_percent_snapshot: 33.33 },
      { price: 6.68, studio_commission_percent_snapshot: 33.33 },
    ],
  });
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30);
  expect(split.studio).toBe(3.34);
  expect(split.professional).toBe(6.67);
  expect(split.studio + split.professional).toBe(10.01);
});

test("13. transações duplicadas pelo mesmo id não são contabilizadas duas vezes", () => {
  const appt = appointment("a13", 100, { status: "completed" });
  const duplicate = {
    id: "pi-13",
    appointment_id: appt.id,
    amount_cents: 10_000,
    status: "succeeded",
  };
  const paymentFacts = facts([duplicate, duplicate]);
  const split = computeAppointmentFinancialSplit(appt.id, appt, 30, paymentFacts.get(appt.id));
  expect(split.received).toBe(100);
  expect(split.pending).toBe(0);
  expect(split.total).toBe(split.received + split.pending);
});

test("Dashboard, Agenda, Equipa e Financeiro usam o mesmo núcleo financeiro", () => {
  for (const file of [
    "src/routes/_authenticated/admin.index.tsx",
    "src/routes/_authenticated/admin.agenda.tsx",
    "src/routes/_authenticated/admin.equipa.tsx",
  ]) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source, file).toContain("computeAppointmentFinancialSplit");
    expect(source, file).toContain("buildAppointmentPaymentFacts");
  }
  const payments = readFileSync(
    resolve(process.cwd(), "src/lib/financial-report.ts"),
    "utf8",
  );
  expect(payments).toContain("buildAppointmentPaymentFacts");
  expect(payments).toContain("computeAppointmentFinancialSplit");
});

test("migração congela comissão sem reescrever valores financeiros", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260827180000_financial_commission_snapshots.sql"),
    "utf8",
  );
  expect(migration).toContain("studio_commission_percent_snapshot");
  expect(migration).toContain("trg_capture_appointment_commission_snapshot");
  expect(migration).toContain("trg_capture_appointment_service_commission_snapshot");
  expect(migration).toContain("trg_refresh_reassigned_appointment_line_commissions");
  expect(migration).not.toMatch(/UPDATE\s+public\.payment_intents/i);
  expect(migration).not.toMatch(/UPDATE\s+public\.cash_register_movements/i);
  expect(migration).not.toMatch(/UPDATE\s+public\.appointments\s+SET\s+total_price/i);
});

test("períodos do Dashboard têm início e fim explícitos", () => {
  const dashboard = readFileSync(
    resolve(process.cwd(), "src/routes/_authenticated/admin.index.tsx"),
    "utf8",
  );
  expect(dashboard.match(/startsAt >= periodStart && startsAt < periodEnd/g)?.length).toBeGreaterThanOrEqual(2);
});
