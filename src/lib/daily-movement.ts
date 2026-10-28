export type DailyMovementChartDay = {
  key: string;
  day: string;
  fullDate: string;
  total: number;
  received: number;
  pending: number;
  appointments: number;
};

export type DailyMovementSummary = {
  scheduled: number;
  received: number;
  pending: number;
  appointments: number;
};

export function summarizeDailyMovement(data: DailyMovementChartDay[]): DailyMovementSummary {
  return data.reduce<DailyMovementSummary>(
    (summary, day) => ({
      scheduled: roundMoney(summary.scheduled + day.total),
      received: roundMoney(summary.received + day.received),
      pending: roundMoney(summary.pending + day.pending),
      appointments: summary.appointments + day.appointments,
    }),
    { scheduled: 0, received: 0, pending: 0, appointments: 0 },
  );
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
