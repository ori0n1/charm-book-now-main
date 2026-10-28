type AppointmentServiceProfessionalLine = {
  position?: number | null;
  staff?:
    | { id?: string | null; name?: string | null }
    | { id?: string | null; name?: string | null }[]
    | null;
};

export function getAppointmentProfessionalNames(
  lines: AppointmentServiceProfessionalLine[] | null | undefined,
  legacyProfessionalName?: string | null,
) {
  const names: string[] = [];
  const seen = new Set<string>();
  const orderedLines = (lines ?? [])
    .map((line, index) => ({ line, index }))
    .sort((left, right) => {
      const leftPosition = left.line.position;
      const rightPosition = right.line.position;
      if (leftPosition == null && rightPosition == null) return left.index - right.index;
      if (leftPosition == null) return 1;
      if (rightPosition == null) return -1;
      return leftPosition - rightPosition || left.index - right.index;
    });

  for (const { line } of orderedLines) {
    const professional = Array.isArray(line.staff) ? line.staff[0] : line.staff;
    const name = String(professional?.name ?? "").trim();
    const key = name.toLocaleLowerCase("pt-PT");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  if (names.length === 0) {
    const legacyName = String(legacyProfessionalName ?? "").trim();
    if (legacyName) names.push(legacyName);
  }

  return names;
}

export function getAppointmentProfessionalDisplayName(
  lines: AppointmentServiceProfessionalLine[] | null | undefined,
  legacyProfessionalName?: string | null,
) {
  return getAppointmentProfessionalNames(lines, legacyProfessionalName).join(", ") || "Profissional";
}

export function getAppointmentProfessionalLabel(names: string[]) {
  return names.length > 1 ? "Profissionais" : "Profissional";
}
