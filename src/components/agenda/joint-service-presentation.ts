import { formatStudioTime, getStudioDateKey } from "../../lib/studio-time.ts";

export type JointAgendaServiceLine = {
  id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  staff?: { id: string; name: string } | null;
  services?: { name: string } | null;
};

export function hasJointProfessionals(lines: JointAgendaServiceLine[]) {
  return new Set(lines.map((line) => line.staff?.id).filter(Boolean)).size > 1;
}

export function visibleServiceLinesForAgenda<T extends JointAgendaServiceLine>(
  lines: T[],
  dateKey: string,
  staffId: string,
  timeZone?: string | null,
) {
  return lines.filter(
    (line) =>
      Boolean(line.starts_at) &&
      getStudioDateKey(line.starts_at!, timeZone) === dateKey &&
      (staffId === "all" || line.staff?.id === staffId),
  );
}

export function describeJointColleagues(
  lines: JointAgendaServiceLine[],
  ownLine: JointAgendaServiceLine,
  timeZone?: string | null,
) {
  return lines
    .filter((line) => line !== ownLine && line.staff?.id !== ownLine.staff?.id)
    .map((line) =>
      `${line.staff?.name ?? "Profissional"}: ${line.services?.name ?? "Serviço"}, ${formatStudioTime(line.starts_at!, timeZone)}–${formatStudioTime(line.ends_at!, timeZone)}`,
    )
    .join("; ");
}
