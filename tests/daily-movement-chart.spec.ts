import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { summarizeDailyMovement, type DailyMovementChartDay } from "../src/lib/daily-movement";

function day(
  key: string,
  values: Pick<DailyMovementChartDay, "total" | "received" | "pending" | "appointments">,
): DailyMovementChartDay {
  return { key, day: key.slice(5), fullDate: key, ...values };
}

test("resume dias sem movimento, agendados, parcialmente recebidos e totalmente recebidos", () => {
  const data = [
    day("2026-09-10", { total: 0, received: 0, pending: 0, appointments: 0 }),
    day("2026-09-11", { total: 60, received: 0, pending: 60, appointments: 1 }),
    day("2026-09-12", { total: 60, received: 45, pending: 15, appointments: 3 }),
    day("2026-09-13", { total: 60, received: 60, pending: 0, appointments: 1 }),
  ];

  expect(summarizeDailyMovement(data)).toEqual({
    scheduled: 180,
    received: 105,
    pending: 75,
    appointments: 5,
  });
});

test("preserva valores recebidos de uma falta sem fabricar receita agendada", () => {
  const noShowWithRetainedDeposit = [
    day("2026-09-14", { total: 0, received: 20, pending: 0, appointments: 1 }),
  ];

  expect(summarizeDailyMovement(noShowWithRetainedDeposit)).toEqual({
    scheduled: 0,
    received: 20,
    pending: 0,
    appointments: 1,
  });
});

test("usa barras financeiras empilhadas, linha agendada e marcações apenas no tooltip", async () => {
  const source = await readFile("src/components/dashboard/daily-movement-chart.tsx", "utf8");

  expect(source).toContain('dataKey="received"');
  expect(source).toContain('dataKey="pending"');
  expect(source).toContain('stackId="finance"');
  expect(source).toContain('dataKey="total"');
  expect(source).not.toContain('dataKey="appointments"');
  expect(source).toContain('day.appointments === 1 ? "marcação" : "marcações"');
  expect(source).toContain("Receita por dia");
  expect(source).toContain("Acompanhe quanto foi agendado, recebido e ainda está por receber.");
  expect(source).toContain("const hasMovement = data.some(");
  expect(source).toContain("Sem movimentação neste período.");
  expect(source).toContain("As receitas aparecerão aqui quando houver marcações.");
});

test("mantém todos os dias, reduz labels e não cria rolagem horizontal no gráfico", async () => {
  const [chart, overview] = await Promise.all([
    readFile("src/components/dashboard/daily-movement-chart.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.index.tsx", "utf8"),
  ]);

  expect(chart).toContain('ResponsiveContainer width="100%" height="100%"');
  expect(chart).toContain("Math.ceil(data.length / labelCapacity)");
  expect(chart).not.toContain("overflow-x-auto");
  expect(chart).not.toContain("Math.max(viewportWidth, 620)");
  expect(overview).toContain("date = addCalendarDays(date, 1)");
  expect(overview).toContain("current.pending += row.split.pending");
});

test("integra 7 dias, 30 dias, mês e personalizado à mesma seleção do painel", async () => {
  const overview = await readFile("src/routes/_authenticated/admin.index.tsx", "utf8");

  expect(overview).toContain('{ value: "7d", label: "7 dias" }');
  expect(overview).toContain('{ value: "30d", label: "30 dias" }');
  expect(overview).toContain('{ value: "month", label: "Este mês" }');
  expect(overview).toContain('{ value: "custom", label: "Personalizado" }');
  expect(overview).toContain(
    "const chartData = buildDailyData(periodRows, periodStart, periodEnd)",
  );
  expect(overview).toContain("Intervalo disponível: últimos 60 dias.");
});
