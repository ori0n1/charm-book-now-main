export type ManualAppointmentStaffServiceLink = {
  staff_id: string;
  service_id: string;
};

export type ManualServiceAssignment = {
  serviceId: string;
  staffId: string;
  durationMin?: number;
};

export type ManualServiceSegment = ManualServiceAssignment & {
  startsAt: string;
  endsAt: string;
  durationMin: number;
};

export function tenantScopedStaffServiceLinks(
  links: readonly ManualAppointmentStaffServiceLink[],
  staffIds: Iterable<string>,
  serviceIds: Iterable<string>,
) {
  const allowedStaffIds = new Set(staffIds);
  const allowedServiceIds = new Set(serviceIds);
  return links.filter(
    (link) => allowedStaffIds.has(link.staff_id) && allowedServiceIds.has(link.service_id),
  );
}

export function manualAppointmentServicesForStaff<T extends { id: string }>(
  services: readonly T[],
  links: readonly ManualAppointmentStaffServiceLink[],
  staffId: string,
) {
  if (!staffId) return [];
  const serviceIds = new Set(
    links.filter((link) => link.staff_id === staffId).map((link) => link.service_id),
  );
  return services.filter((service) => serviceIds.has(service.id));
}

export function isManualAppointmentServiceAllowed(
  links: readonly ManualAppointmentStaffServiceLink[],
  staffId: string,
  serviceId: string,
) {
  return links.some((link) => link.staff_id === staffId && link.service_id === serviceId);
}

export function manualAppointmentStaffForService<T extends { id: string }>(
  staff: readonly T[],
  links: readonly ManualAppointmentStaffServiceLink[],
  serviceId: string,
) {
  const staffIds = new Set(
    links.filter((link) => link.service_id === serviceId).map((link) => link.staff_id),
  );
  return staff.filter((person) => staffIds.has(person.id));
}

export function filterAndSortManualAppointmentServices<T extends { name: string }>(
  services: readonly T[],
  query: string,
) {
  const normalizedQuery = normalizeManualServiceSearch(query.trim());
  return services
    .filter(
      (service) =>
        !normalizedQuery || normalizeManualServiceSearch(service.name).includes(normalizedQuery),
    )
    .slice()
    .sort((first, second) =>
      first.name.localeCompare(second.name, "pt-PT", { sensitivity: "base" }),
    );
}

function normalizeManualServiceSearch(value: string) {
  return value
    .toLocaleLowerCase("pt-PT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function buildManualServiceSegments<T extends { id: string; duration_min: number }>(
  services: readonly T[],
  assignments: readonly ManualServiceAssignment[],
  startsAt: string,
): ManualServiceSegment[] {
  const servicesById = new Map(services.map((service) => [service.id, service]));
  let cursor = new Date(startsAt).getTime();
  if (!Number.isFinite(cursor)) return [];

  return assignments.flatMap((assignment) => {
    const service = servicesById.get(assignment.serviceId);
    if (!service || !assignment.staffId || service.duration_min <= 0) return [];
    const durationMin = assignment.durationMin ?? service.duration_min;
    if (!Number.isInteger(durationMin) || durationMin < 5 || durationMin > service.duration_min) return [];
    const segmentStartsAt = new Date(cursor).toISOString();
    cursor += durationMin * 60_000;
    return [
      {
        ...assignment,
        startsAt: segmentStartsAt,
        endsAt: new Date(cursor).toISOString(),
        durationMin,
      },
    ];
  });
}
