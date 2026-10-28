export function appointmentConfirmationIdempotencyKey(
  appointmentId: string | null | undefined,
  fallback: string,
) {
  return appointmentId ? `senddm-whatsapp-confirmation-appointment-${appointmentId}` : fallback;
}

export function shouldSendAutomaticManualAppointmentConfirmation(status?: string | null) {
  // Walk-ins are completed immediately because the client is served on the spot.
  // Only a regular scheduled appointment receives an automatic confirmation.
  return status === "confirmed";
}
