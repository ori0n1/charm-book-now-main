import { supabase } from "@/integrations/supabase/client";

const AVAILABILITY_DEBUG = "[booking-availability]";

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
}): Promise<AvailableSlot[]> {
  const dateStr = formatDateLocal(params.date);
  const minBookingNoticeMin = Math.max(0, params.minBookingNoticeMin ?? 30);
  console.info(AVAILABILITY_DEBUG, "loading", {
    studioSlug: params.studioSlug,
    staffId: params.staffId ?? "any",
    date: dateStr,
    durationMin: params.durationMin,
    minBookingNoticeMin,
  });
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_studio_slug: params.studioSlug,
    p_staff_id: params.staffId as string,
    p_date: dateStr,
    p_duration_min: params.durationMin,
    p_slot_step_min: Math.max(15, params.durationMin),
  });
  if (error) {
    console.error(AVAILABILITY_DEBUG, "rpc_failed", error);
    throw new Error(classifyAvailabilityError(error.message));
  }
  const slots = filterSlotsByMinimumNotice((data ?? []) as AvailableSlot[], minBookingNoticeMin);
  console.info(AVAILABILITY_DEBUG, "loaded", {
    count: data?.length ?? 0,
    visibleCount: slots.length,
  });
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

// YYYY-MM-DD usando data local do utilizador (sem deslocamento UTC)
function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
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
