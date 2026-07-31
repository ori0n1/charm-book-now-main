export type ProfessionalTimelinePerson = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export type ProfessionalTimelineAppointment = {
  id: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  clientName: string;
  serviceName: string;
  professionalName: string;
  valueLabel?: string;
  durationLabel: string;
  privateDetails: boolean;
};

export type PositionedTimelineAppointment = ProfessionalTimelineAppointment & {
  top: number;
  height: number;
  lane: number;
  laneCount: number;
};

export function layoutProfessionalAppointments(
  appointments: ProfessionalTimelineAppointment[],
  startHour: number,
  hourHeight: number,
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
      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const durationMinutes = Math.max(15, (end.getTime() - start.getTime()) / 60_000);
      result.push({
        ...appointment,
        top: ((startMinutes - startHour * 60) / 60) * hourHeight,
        height: (durationMinutes / 60) * hourHeight,
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
) {
  if (appointments.length === 0) return { startHour: 8, endHour: 20 };
  const firstHour = Math.min(
    ...appointments.map((appointment) => new Date(appointment.startsAt).getHours()),
  );
  const lastHour = Math.max(
    ...appointments.map((appointment) => {
      const end = new Date(appointment.endsAt);
      return end.getHours() + (end.getMinutes() > 0 ? 1 : 0);
    }),
  );
  return {
    startHour: Math.max(0, Math.min(8, firstHour) - 1),
    endHour: Math.min(24, Math.max(20, lastHour) + 1),
  };
}
