export function shouldDeliverManualAppointmentPush(input: {
  actorId: string | null;
  recipientId: string;
  professionalUserIds: readonly string[];
}) {
  if (!input.actorId) return true;
  return input.recipientId !== input.actorId &&
    input.professionalUserIds.includes(input.recipientId);
}
