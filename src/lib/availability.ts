import { supabase } from "@/integrations/supabase/client";

const AVAILABILITY_DEBUG = "[booking-availability]";

function isAvailabilityDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("bellza:availability-debug") === "1";
  } catch {
    return false;
  }
}

function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

function logAvailability(event: string, payload: Record<string, unknown>) {
  if (!isAvailabilityDebugEnabled()) return;
  console.info(AVAILABILITY_DEBUG, event, payload);
}

export type AvailableSlot = {
  staff_id: string;
  slot_start: string; // ISO timestamptz
  slot_label: string; // HH:MM (Europe/Lisbon)
};

export async function fetchAvailableSlots(params: {
  studioSlug: string;
  staffId: string | null; // null = qualquer profissional
  date: Date;
  durationMin: number;
  minBookingNoticeMin?: number;
  studioTimezone?: string | null;
}): Promise<AvailableSlot[]> {
  const studioTimezone = params.studioTimezone || "Europe/Lisbon";
  const dateStr = formatDateInTimeZone(params.date, studioTimezone);
  const minBookingNoticeMin = Math.max(0, params.minBookingNoticeMin ?? 30);
  logAvailability("request", {
    studioSlug: params.studioSlug,
    staffId: maskId(params.staffId) ?? "any",
    frontendDateIso: params.date.toISOString(),
    apiDate: dateStr,
    date: dateStr,
    durationMin: params.durationMin,
    minBookingNoticeMin,
    studioTimezone,
  });
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_studio_slug: params.studioSlug,
    p_staff_id: params.staffId as string,
    p_date: dateStr,
    p_duration_min: params.durationMin,
    p_slot_step_min: 15,
  });
  if (error) {
    console.error(AVAILABILITY_DEBUG, "rpc_failed", error);
    throw new Error(classifyAvailabilityError(error.message));
  }
  const rawSlots = (data ?? []) as AvailableSlot[];
  const slots = filterSlotsByMinimumNotice(rawSlots, minBookingNoticeMin);
  const removedByNotice = rawSlots.length - slots.length;
  logAvailability("loaded", {
    count: rawSlots.length,
    visibleCount: slots.length,
    removedByNotice,
    date: dateStr,
    staffId: maskId(params.staffId) ?? "any",
    firstSlot: slots[0]?.slot_label ?? null,
    lastSlot: slots.at(-1)?.slot_label ?? null,
  });
  if (rawSlots.length === 0) {
    logAvailability("empty_result", {
      studioSlug: params.studioSlug,
      staffId: maskId(params.staffId) ?? "any",
      date: dateStr,
      durationMin: params.durationMin,
      studioTimezone,
      stage: "rpc_returned_zero_slots",
    });
  } else if (slots.length === 0) {
    logAvailability("empty_result", {
      studioSlug: params.studioSlug,
      staffId: maskId(params.staffId) ?? "any",
      date: dateStr,
      durationMin: params.durationMin,
      minBookingNoticeMin,
      removedByNotice,
      studioTimezone,
      stage: "minimum_notice_removed_all_slots",
    });
  }
  return slots;
}

export function filterSlotsByMinimumNotice(
  slots: AvailableSlot[],
  minBookingNoticeMin: number,
): AvailableSlot[] {
  const notice = Math.max(0, minBookingNoticeMin);
  if (notice <= 0) return slots;

  const minimumStart = Date.now() + notice * 60_000;
  return slots.filter((slot) => {
    const start = Date.parse(slot.slot_start);
    return Number.isFinite(start) && start >= minimumStart;
  });
}

function classifyAvailabilityError(message: string): string {
  if (message.includes("generate_series")) {
    return "A agenda interna precisa de atualização técnica. Tente novamente em instantes.";
  }
  if (message.includes("invalid input syntax")) {
    return "Não conseguimos ler esta data. Escolha outro dia.";
  }
  if (message.includes("permission denied")) {
    return "A agenda do estúdio não está acessível publicamente.";
  }
  return "Não foi possível consultar a agenda interna agora.";
}

// YYYY-MM-DD pela data civil do estúdio, não pelo timezone do browser.
function formatDateInTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const read = (type: string) => parts.find((part) => part.type === type)?.value;
    const year = read("year");
    const month = read("month");
    const day = read("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    /* fall back to local date below */
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupSlots(slots: AvailableSlot[]) {
  const morning: AvailableSlot[] = [];
  const afternoon: AvailableSlot[] = [];
  const evening: AvailableSlot[] = [];
  for (const s of slots) {
    const h = parseInt(s.slot_label.slice(0, 2), 10);
    if (h < 12) morning.push(s);
    else if (h < 17) afternoon.push(s);
    else evening.push(s);
  }
  // De-duplicar por slot_label (quando staffId é null podem vir vários staff por hora)
  const dedup = (arr: AvailableSlot[]) => {
    const seen = new Set<string>();
    return arr.filter((s) => {
      if (seen.has(s.slot_label)) return false;
      seen.add(s.slot_label);
      return true;
    });
  };
  return { morning: dedup(morning), afternoon: dedup(afternoon), evening: dedup(evening) };
}
