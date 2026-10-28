export function normalizePublicClientEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function canExposePublicClientRecord(input: { recordAuthUserId?: string | null; sessionUserId?: string | null }) {
  const recordAuthUserId = String(input.recordAuthUserId ?? "").trim();
  const sessionUserId = String(input.sessionUserId ?? "").trim();
  return Boolean(recordAuthUserId && sessionUserId && recordAuthUserId === sessionUserId);
}

export function canAttachAppointmentClientToSession(input: {
  currentAuthUserId?: string | null;
  clientEmail?: string | null;
  sessionUserId?: string | null;
  sessionEmail?: string | null;
}) {
  const currentAuthUserId = String(input.currentAuthUserId ?? "").trim();
  const sessionUserId = String(input.sessionUserId ?? "").trim();
  const clientEmail = normalizePublicClientEmail(input.clientEmail);
  const sessionEmail = normalizePublicClientEmail(input.sessionEmail);

  if (!sessionUserId) return false;
  if (currentAuthUserId && currentAuthUserId !== sessionUserId) return false;
  if (clientEmail && clientEmail !== sessionEmail) return false;
  return true;
}
