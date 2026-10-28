import { getStudioDateKey, getZonedMinutes } from "@/lib/studio-time";

export type ProfessionalTimelinePerson = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export type ProfessionalAvailabilityPeriod = {
  staffId: string;
  startMinutes: number;
  endMinutes: number;
};

export function getVisualOperatingHours(
  schedule: Array<ProfessionalAvailabilityPeriod & { weekday: number }>,
  weekday: number,
): ProfessionalAvailabilityPeriod[] {
  return schedule.flatMap((period) => {
    if (period.weekday === weekday) {
      return [{ staffId: period.staffId, startMinutes: period.startMinutes,
        endMinutes: period.endMinutes > period.startMinutes ? period.endMinutes : 1440 }];
    }
    if (period.weekday === (weekday + 6) % 7 && period.endMinutes < period.startMinutes) {
      return [{ staffId: period.staffId, startMinutes: 0, endMinutes: period.endMinutes }];
    }
    return [];
  }).filter((period) => period.endMinutes > period.startMinutes);
}

// Presentation only: complement the configured working shifts inside the visible day.
export function getOutsideOperatingPeriods(
  staffId: string,
  operatingHours: ProfessionalAvailabilityPeriod[],
  startMinutes: number,
  endMinutes: number,
) {
  const shifts = operatingHours
    .filter((period) => period.staffId === staffId)
    .map((period) => ({
      startMinutes: Math.max(startMinutes, period.startMinutes),
      endMinutes: Math.min(endMinutes, period.endMinutes),
    }))
    .filter((period) => period.endMinutes > period.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);
  const outside: Array<{ startMinutes: number; endMinutes: number }> = [];
  let cursor = startMinutes;
  for (const shift of shifts) {
    if (shift.startMinutes > cursor) outside.push({ startMinutes: cursor, endMinutes: shift.startMinutes });
    cursor = Math.max(cursor, shift.endMinutes);
  }
  if (cursor < endMinutes) outside.push({ startMinutes: cursor, endMinutes });
  return outside;
}

// Display only: subtract the agenda's existing entries from each professional's
// published periods. Internal gaps are intervals; outside hours remain unlabelled.
export function getTimelineVisualPeriods(
  staffId: string,
  availability: ProfessionalAvailabilityPeriod[],
  appointments: ProfessionalTimelineOccupancy[],
  timeZone: string,
  dateKey?: string,
) {
  const periods = availability.filter((p) => p.staffId === staffId && p.endMinutes > p.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);
  const merged: Array<{ startMinutes: number; endMinutes: number }> = [];
  for (const period of periods) {
    const last = merged.at(-1);
    if (last && period.startMinutes <= last.endMinutes) last.endMinutes = Math.max(last.endMinutes, period.endMinutes);
    else merged.push({ startMinutes: period.startMinutes, endMinutes: period.endMinutes });
  }
  const occupied = appointments.filter((a) => a.staffId === staffId && a.status !== "cancelled"
    && (!dateKey || (getStudioDateKey(a.startsAt, timeZone) <= dateKey && getStudioDateKey(a.endsAt, timeZone) >= dateKey))).map((a) => {
    const startsBeforeDay = Boolean(dateKey && getStudioDateKey(a.startsAt, timeZone) < dateKey);
    const startMinutes = startsBeforeDay ? 0 : getZonedMinutes(a.startsAt, timeZone);
    // Match the existing card's visual minimum without changing its real duration.
    const endMinutes = dateKey && getStudioDateKey(a.endsAt, timeZone) > dateKey ? 1440
      : startsBeforeDay ? getZonedMinutes(a.endsAt, timeZone)
      : startMinutes + Math.max(15, (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000);
    return { startMinutes, endMinutes };
  });
  const result: Array<{ startMinutes: number; endMinutes: number; kind: "free" | "break" }> = [];
  const subtract = (start: number, end: number, kind: "free" | "break") => {
    let gaps = [{ startMinutes: start, endMinutes: end }];
    for (const busy of occupied) gaps = gaps.flatMap((g) => busy.startMinutes >= g.endMinutes || busy.endMinutes <= g.startMinutes ? [g] : [
      { startMinutes: g.startMinutes, endMinutes: Math.min(g.endMinutes, busy.startMinutes) },
      { startMinutes: Math.max(g.startMinutes, busy.endMinutes), endMinutes: g.endMinutes },
    ].filter((g) => g.endMinutes > g.startMinutes));
    result.push(...gaps.map((g) => ({ ...g, kind })));
  };
  merged.forEach((p, index) => {
    subtract(p.startMinutes, p.endMinutes, "free");
    if (merged[index + 1]) subtract(p.endMinutes, merged[index + 1].startMinutes, "break");
  });
  return result;
}

export type ProfessionalTimelineAppointment = {
  id: string;
  sourceId?: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  kind?: "appointment" | "block";
  clientName: string;
  serviceName: string;
  professionalName: string;
  valueLabel?: string;
  durationLabel: string;
  privateDetails: boolean;
  jointBooking?: boolean;
  relatedServiceSummary?: string;
  attendancePending?: boolean;
  manualFit?: boolean;
};

export type ProfessionalTimelineOccupancy = Pick<ProfessionalTimelineAppointment,
  "staffId" | "startsAt" | "endsAt" | "status">;

export type PositionedTimelineAppointment = ProfessionalTimelineAppointment & {
  top: number;
  height: number;
  lane: number;
  laneCount: number;
};

export function getTimelineSlotMinutes(
  clientY: number,
  timelineTop: number,
  startHour: number,
  endHour: number,
  hourHeight: number,
) {
  const rawMinutes = startHour * 60 + ((clientY - timelineTop) / hourHeight) * 60;
  const slotMinutes = Math.floor(rawMinutes / 15) * 15;
  return Math.max(startHour * 60, Math.min(endHour * 60 - 15, slotMinutes));
}

export function isProfessionalAvailableAtMinute(
  availability: ProfessionalAvailabilityPeriod[],
  staffId: string,
  minutes: number,
) {
  return availability.some(
    (period) =>
      period.staffId === staffId && period.startMinutes <= minutes && period.endMinutes > minutes,
  );
}

export function layoutProfessionalAppointments(
  appointments: ProfessionalTimelineAppointment[],
  startHour: number,
  hourHeight: number,
  timeZone = "Europe/Lisbon",
  endHour = 24,
) {
  const sorted = [...appointments].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  const result: PositionedTimelineAppointment[] = [];
  let group: ProfessionalTimelineAppointment[] = [];
  let groupEnd = 0;

  const flush = () => {
    if (group.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = group.map((appointment) => {
      const start = new Date(appointment.startsAt).getTime();
      const end = Math.max(start + 15 * 60_000, new Date(appointment.endsAt).getTime());
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = end;
      return { appointment, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);

    for (const { appointment, lane } of assigned) {
      const start = new Date(appointment.startsAt);
      const end = new Date(appointment.endsAt);
      const startMinutes = getZonedMinutes(start, timeZone);
      const durationMinutes = Math.max(15, (end.getTime() - start.getTime()) / 60_000);
      const visibleDurationMinutes = Math.max(
        1,
        Math.min(durationMinutes, endHour * 60 - startMinutes),
      );
      result.push({
        ...appointment,
        top: ((startMinutes - startHour * 60) / 60) * hourHeight,
        height: (visibleDurationMinutes / 60) * hourHeight,
        lane,
        laneCount,
      });
    }

    group = [];
    groupEnd = 0;
  };

  for (const appointment of sorted) {
    const start = new Date(appointment.startsAt).getTime();
    const end = Math.max(start + 15 * 60_000, new Date(appointment.endsAt).getTime());
    if (group.length > 0 && start >= groupEnd) flush();
    group.push(appointment);
    groupEnd = Math.max(groupEnd, end);
  }
  flush();

  return result;
}

export function getProfessionalTimelineBounds(
  appointments: ProfessionalTimelineAppointment[],
  availability?: Array<{ startMinutes: number; endMinutes: number }>,
  timeZone = "Europe/Lisbon",
) {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const appointment of appointments) {
    const start = new Date(appointment.startsAt);
    const end = new Date(appointment.endsAt);
    const startMinutes = getZonedMinutes(start, timeZone);
    const durationMinutes = Math.max(15, (end.getTime() - start.getTime()) / 60_000);
    starts.push(startMinutes / 60);
    // Use the real duration instead of the zoned clock at the end. An appointment
    // crossing midnight must extend to the end of this day's timeline, not wrap
    // the bound back to 00h/01h.
    ends.push((startMinutes + durationMinutes) / 60);
  }
  for (const period of availability ?? []) {
    starts.push(period.startMinutes / 60);
    ends.push(period.endMinutes / 60);
  }
  if (starts.length === 0) return { startHour: 8, endHour: 20 };
  const firstHour = Math.floor(Math.min(...starts));
  const lastHour = Math.ceil(Math.max(...ends));
  return {
    startHour: Math.max(0, Math.min(8, firstHour)),
    endHour: Math.min(24, Math.max(20, lastHour)),
  };
}
