type MoveNotice = {
  studioId: string;
  notificationId: string;
  appointmentId: string;
  startsAt: string;
  recipientId: string;
  recipientRole: string;
};

// Both records are created by the move RPC in one transaction. Their identical
// created_at values tie the notification to its audited author without relying
// on any actor identifier supplied by the browser or the notification payload.
export async function isOwnerSelfReschedule(sb: any, notice: MoveNotice): Promise<boolean> {
  if (!['studio_owner', 'saas_owner'].includes(notice.recipientRole) ||
      !notice.appointmentId || !Number.isFinite(Date.parse(notice.startsAt))) return false;

  const { data: notification, error: notificationError } = await sb.from('studio_notifications')
    .select('created_at')
    .eq('id', notice.notificationId)
    .eq('studio_id', notice.studioId)
    .eq('kind', 'appointment_rescheduled')
    .maybeSingle();
  if (notificationError) throw new Error(notificationError.message);
  if (!notification?.created_at) return false;

  const { data: events, error: eventError } = await sb.from('appointment_schedule_events')
    .select('actor_id,operation,previous_state,next_state')
    .eq('studio_id', notice.studioId)
    .eq('appointment_id', notice.appointmentId)
    .eq('created_at', notification.created_at)
    .in('operation', ['move', 'manual_fit'])
    .limit(2);
  if (eventError) throw new Error(eventError.message);
  if (events?.length !== 1) return false;
  const event = events[0];
  return event.actor_id === notice.recipientId &&
    Number.isFinite(Date.parse(event.previous_state?.startsAt ?? '')) &&
    Date.parse(event.previous_state.startsAt) !== Date.parse(notice.startsAt) &&
    Date.parse(event.next_state?.startsAt ?? '') === Date.parse(notice.startsAt);
}
