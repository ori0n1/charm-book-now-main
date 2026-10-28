export const PUBLIC_BOOKING_SELECTION_PARAM = "reserva";

export type PublicBookingSelection = {
  studioSlug: string;
  serviceIds: string[];
  professionalId: string;
  staffByServiceId: Record<string, string>;
  dateIso: string;
  time: string;
  slot: { staff_id: string; slot_start: string; slot_label: string };
  extras: Record<string, boolean>;
};

// The URL carries only the selection, never customer details or credentials.
export function encodePublicBookingSelection(selection: PublicBookingSelection) {
  return JSON.stringify({ v: 1, ...selection });
}

export function decodePublicBookingSelection(raw: string | null, studioSlug: string): PublicBookingSelection | null {
  if (!raw || raw.length > 2500) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.v !== 1 || value.studioSlug !== studioSlug) return null;
    const serviceIds = value.serviceIds;
    const slot = value.slot as Record<string, unknown> | null;
    if (!Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 12 ||
      !serviceIds.every((id) => typeof id === "string" && id.length <= 80) ||
      typeof value.professionalId !== "string" || value.professionalId.length > 80 ||
      typeof value.dateIso !== "string" || !Number.isFinite(Date.parse(value.dateIso)) ||
      typeof value.time !== "string" || !/^\d{2}:\d{2}$/.test(value.time) ||
      !slot || typeof slot.staff_id !== "string" || typeof slot.slot_start !== "string" ||
      !Number.isFinite(Date.parse(slot.slot_start)) || typeof slot.slot_label !== "string") return null;
    const staffByServiceId = value.staffByServiceId;
    const extras = value.extras;
    if (!staffByServiceId || typeof staffByServiceId !== "object" || Array.isArray(staffByServiceId) ||
      !extras || typeof extras !== "object" || Array.isArray(extras)) return null;
    return {
      studioSlug,
      serviceIds: serviceIds as string[],
      professionalId: value.professionalId,
      staffByServiceId: Object.fromEntries(Object.entries(staffByServiceId).filter(([key, id]) =>
        key.length <= 80 && typeof id === "string" && id.length <= 80)) as Record<string, string>,
      dateIso: value.dateIso,
      time: value.time,
      slot: { staff_id: slot.staff_id, slot_start: slot.slot_start, slot_label: slot.slot_label },
      extras: Object.fromEntries(Object.entries(extras).filter(([key, enabled]) =>
        key.length <= 80 && enabled === true)) as Record<string, boolean>,
    };
  } catch {
    return null;
  }
}
