export type AttendanceEvent = { staffId: string; appointmentId: string; date: string };
export type ServiceEvent = { staffId: string; lineId: string; serviceId: string; name: string | null | undefined };

export function periodDateKeys(today: string, days: 1 | 7 | 15 | 30) {
  const [year, month, day] = today.split("-").map(Number);
  return Array.from({ length: days }, (_, index) =>
    new Date(Date.UTC(year, month - 1, day - days + 1 + index)).toISOString().slice(0, 10));
}

export function summarizeProfessionalHistory(
  staffIds: string[],
  dateKeys: string[],
  attendanceEvents: AttendanceEvent[],
  serviceEvents: ServiceEvent[],
) {
  const summaries = Object.fromEntries(staffIds.map((staffId) => [staffId, {
    completed: 0,
    evolution: dateKeys.map((date) => ({ date, completed: 0 })),
    topServices: [] as { serviceId: string; name: string; count: number; percent: number }[],
  }]));
  const seenAttendance = new Set<string>();
  for (const event of attendanceEvents) {
    const summary = summaries[event.staffId];
    const key = `${event.staffId}:${event.appointmentId}`;
    if (!summary || seenAttendance.has(key)) continue;
    seenAttendance.add(key);
    summary.completed++;
    const bucket = summary.evolution.find((item) => item.date === event.date);
    if (bucket) bucket.completed++;
  }

  const seenServices = new Set<string>();
  const countsByStaff = new Map<string, Map<string, { name: string; count: number }>>();
  for (const event of serviceEvents) {
    if (!summaries[event.staffId] || seenServices.has(event.lineId)) continue;
    seenServices.add(event.lineId);
    const counts = countsByStaff.get(event.staffId) ?? new Map<string, { name: string; count: number }>();
    const name = event.name?.trim() || "Serviço removido";
    const prior = counts.get(event.serviceId);
    counts.set(event.serviceId, { name, count: (prior?.count ?? 0) + 1 });
    countsByStaff.set(event.staffId, counts);
  }
  for (const [staffId, counts] of countsByStaff) {
    const total = [...counts.values()].reduce((sum, item) => sum + item.count, 0);
    summaries[staffId].topServices = [...counts].map(([serviceId, { name, count }]) => ({
      serviceId, name, count, percent: Math.round(count * 1000 / total) / 10,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt")).slice(0, 5);
  }
  return summaries;
}
