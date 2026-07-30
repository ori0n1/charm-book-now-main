export type AgendaTimelineItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  clientName: string;
  serviceName: string;
  staffId: string | null;
  staffName: string;
  durationLabel: string;
  privateDetails: boolean;
};

export type TimelineLayoutItem = AgendaTimelineItem & {
  top: number;
  height: number;
  lane: number;
  laneCount: number;
  conflict: boolean;
};

export function buildTimelineLayout(
  items: AgendaTimelineItem[],
  startHour: number,
  hourHeight: number,
): TimelineLayoutItem[] {
  const sorted = [...items].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  const result: TimelineLayoutItem[] = [];
  let group: AgendaTimelineItem[] = [];
  let groupEnd = 0;

  const flush = () => {
    if (group.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = group.map((item) => {
      const start = new Date(item.startsAt).getTime();
      const end = Math.max(start + 15 * 60_000, new Date(item.endsAt).getTime());
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = end;
      return { item, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    for (const entry of assigned) {
      const start = new Date(entry.item.startsAt);
      const end = new Date(entry.item.endsAt);
      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const durationMinutes = Math.max(15, (end.getTime() - start.getTime()) / 60_000);
      result.push({
        ...entry.item,
        top: ((startMinutes - startHour * 60) / 60) * hourHeight,
        height: (durationMinutes / 60) * hourHeight,
        lane: entry.lane,
        laneCount,
        conflict: laneCount > 1 && hasAgendaConflict(entry.item, group),
      });
    }
    group = [];
    groupEnd = 0;
  };

  for (const item of sorted) {
    const start = new Date(item.startsAt).getTime();
    const end = Math.max(start + 15 * 60_000, new Date(item.endsAt).getTime());
    if (group.length > 0 && start >= groupEnd) flush();
    group.push(item);
    groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return result;
}

export function hasAgendaConflict(item: AgendaTimelineItem, items: AgendaTimelineItem[]) {
  const start = new Date(item.startsAt).getTime();
  const end = new Date(item.endsAt).getTime();
  return items.some((candidate) => {
    if (candidate.id === item.id || candidate.staffId !== item.staffId) return false;
    const otherStart = new Date(candidate.startsAt).getTime();
    const otherEnd = new Date(candidate.endsAt).getTime();
    return start < otherEnd && end > otherStart;
  });
}
