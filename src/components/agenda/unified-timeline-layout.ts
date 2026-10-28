import { getZonedMinutes } from "@/lib/studio-time";
import { getTimelineVisualPeriods, type ProfessionalTimelineAppointment,
  type ProfessionalTimelinePerson, type ProfessionalAvailabilityPeriod,
  type ProfessionalTimelineOccupancy } from "./professional-timeline-utils";

// Presentation only: keep original entries, periods and callbacks. A shared
// chronological rail stacks every entry at full width, including simultaneous ones.
export function layoutUnifiedTimeline(
  appointments: ProfessionalTimelineAppointment[],
  professionals: ProfessionalTimelinePerson[],
  availability: ProfessionalAvailabilityPeriod[],
  occupied: ProfessionalTimelineOccupancy[],
  timeZone: string,
  dateKey: string,
) {
  const rows = [
    ...appointments.map(appointment => ({
      minutes: getZonedMinutes(appointment.startsAt, timeZone),
      height: appointment.kind === "block" ? 48 : 82,
      appointment,
      period: null,
    })),
    ...professionals.flatMap(person => getTimelineVisualPeriods(person.id, availability, occupied, timeZone, dateKey)
      .map(period => ({ minutes: period.startMinutes, height: 44, appointment: null,
        period: { ...period, staffId: person.id, professionalName: person.name } }))),
  ].sort((a, b) => a.minutes - b.minutes || Number(!a.appointment) - Number(!b.appointment));
  let top = 8;
  const positioned = rows.map(row => {
    const result = { ...row, top };
    top += row.height + 6;
    return result;
  });
  return {
    rows: positioned,
    height: top + 8,
    appointments: positioned.flatMap(row => row.appointment ? [{ ...row.appointment,
      top: row.top, height: row.height, lane: 0, laneCount: 1 }] : []),
    periods: positioned.flatMap(row => row.period ? [{ ...row.period, top: row.top, height: row.height }] : []),
  };
}
