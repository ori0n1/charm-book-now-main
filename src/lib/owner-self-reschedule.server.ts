type BellNotice = {
  id: string;
  studio_id: string;
  appointment_id?: string | null;
  kind: string;
  created_at: string;
  payload?: Record<string, unknown> | null;
};

type ScheduleEvent = {
  studio_id: string;
  appointment_id: string;
  created_at: string;
  actor_id: string | null;
  operation: string;
  previous_state: Record<string, unknown> | null;
  next_state: Record<string, unknown> | null;
};

type MoveNotice = {
  studioId: string;
  notificationId: string;
  appointmentId: string;
  startsAt: string;
  recipientId: string;
  recipientRole: string;
};

export function projectOwnerBell<T extends { id: string }>(
  history: T[], unreadReschedules: T[], count: number, hidden: Set<string>,
): { items: T[]; unreadCount: number } {
  return {
    items: history.filter((item) => !hidden.has(item.id)),
    unreadCount: Math.max(0, count - unreadReschedules.filter((item) => hidden.has(item.id)).length),
  };
}

function noticeAppointmentId(notice: BellNotice): string | null {
  const payloadId = notice.payload?.appointment_id;
  if (typeof payloadId !== 'string') return null;
  if (notice.appointment_id && notice.appointment_id !== payloadId) return null;
  return payloadId;
}

function sameInstant(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Date.parse(a);
  return Number.isFinite(left) && left === Date.parse(b);
}

export function ownerSelfRescheduleIds(
  notices: BellNotice[], events: ScheduleEvent[], recipientId: string, recipientRole: string,
): Set<string> {
  const hidden = new Set<string>();
  if (!['studio_owner', 'saas_owner'].includes(recipientRole)) return hidden;
  for (const notice of notices) {
    if (notice.kind !== 'appointment_rescheduled') continue;
    const appointmentId = noticeAppointmentId(notice);
    if (!appointmentId || typeof notice.payload?.starts_at !== 'string') continue;
    const matches = events.filter((event) =>
      event.studio_id === notice.studio_id &&
      event.appointment_id === appointmentId &&
      event.created_at === notice.created_at &&
      ['move', 'manual_fit', 'duration'].includes(event.operation) &&
      sameInstant(event.next_state?.startsAt, notice.payload?.starts_at) &&
      (event.previous_state?.startsAt !== event.next_state?.startsAt ||
        event.previous_state?.staffId !== event.next_state?.staffId),
    );
    if (matches.length !== 1) continue;
    const event = matches[0];
    if (event.actor_id !== recipientId) continue;
    const timeChanged = !sameInstant(event.previous_state?.startsAt, event.next_state?.startsAt);
    const staffChanged = event.previous_state?.staffId !== event.next_state?.staffId &&
      (event.next_state?.staffId ?? null) === (notice.payload?.staff_id ?? null);
    if (timeChanged || staffChanged) hidden.add(notice.id);
  }
  return hidden;
}

// The trigger and schedule audit event share the transaction's now() timestamp.
// Query by studio, appointment and timestamp; never trust browser supplied actor IDs.
export async function findOwnerSelfRescheduleIds(
  sb: any, studioId: string, recipientId: string, recipientRole: string, notices: BellNotice[],
): Promise<Set<string>> {
  if (!['studio_owner', 'saas_owner'].includes(recipientRole)) return new Set();
  const candidates = notices.filter((notice) =>
    notice.studio_id === studioId && notice.kind === 'appointment_rescheduled' && noticeAppointmentId(notice),
  );
  const events: ScheduleEvent[] = [];
  const timestamps = [...new Set(candidates.map((notice) => notice.created_at))];
  for (let offset = 0; offset < timestamps.length; offset += 40) {
    const batch = timestamps.slice(offset, offset + 40);
    const appointmentIds = [...new Set(candidates.filter((notice) => batch.includes(notice.created_at))
      .map((notice) => noticeAppointmentId(notice) as string))];
    for (let page = 0; ; page += 1000) {
      const { data, error } = await sb.from('appointment_schedule_events')
        .select('studio_id,appointment_id,created_at,actor_id,operation,previous_state,next_state')
        .eq('studio_id', studioId)
        .in('appointment_id', appointmentIds)
        .in('created_at', batch)
        .in('operation', ['move', 'manual_fit', 'duration'])
        .order('created_at').order('appointment_id').order('id')
        .range(page, page + 999);
      if (error) throw new Error(error.message);
      events.push(...((data ?? []) as ScheduleEvent[]));
      if ((data ?? []).length < 1000) break;
    }
  }
  return ownerSelfRescheduleIds(candidates, events, recipientId, recipientRole);
}

export async function isOwnerSelfReschedule(sb: any, notice: MoveNotice): Promise<boolean> {
  if (!['studio_owner', 'saas_owner'].includes(notice.recipientRole)) return false;
  const { data, error } = await sb.from('studio_notifications')
    .select('id,studio_id,appointment_id,kind,created_at,payload')
    .eq('id', notice.notificationId)
    .eq('studio_id', notice.studioId)
    .eq('kind', 'appointment_rescheduled')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || noticeAppointmentId(data) !== notice.appointmentId ||
      !sameInstant(data.payload?.starts_at, notice.startsAt)) return false;
  const hidden = await findOwnerSelfRescheduleIds(sb, notice.studioId, notice.recipientId,
    notice.recipientRole, [data]);
  return hidden.has(notice.notificationId);
}
