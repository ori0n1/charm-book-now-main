const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NotificationDeepLinkInput = {
  kind: string;
  studioId: string;
  appointmentId?: string | null;
  actionUrl?: string | null;
  payload?: Record<string, unknown> | null;
};

const APPOINTMENT_KINDS = new Set([
  "new_appointment",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_reminder",
  "attendance_confirmation",
  "payment_confirmed",
  "payment_failed",
  "new_review",
]);

export function buildStudioNotificationDeepLink(input: NotificationDeepLinkInput) {
  const studioId = validUuid(input.studioId);
  const appointmentId = validUuid(
    input.appointmentId ?? readPayloadString(input.payload, "appointment_id"),
  );
  const clientId = validUuid(readPayloadString(input.payload, "client_id"));
  const fallback = sanitizeAdminPath(
    input.actionUrl ?? readPayloadString(input.payload, "action_url"),
    defaultNotificationPath(input.kind),
  );

  if (studioId && appointmentId && APPOINTMENT_KINDS.has(input.kind)) {
    return withScopedEntity("/admin/agenda", "appointment", appointmentId, studioId);
  }

  if (studioId && clientId && input.kind === "new_client") {
    return withScopedEntity("/admin/clientes", "client", clientId, studioId);
  }

  return fallback;
}

export function resolveScopedNotificationEntity(input: {
  entityId?: string;
  targetStudioId?: string;
  currentStudioId: string;
  availableEntityIds: Iterable<string>;
}) {
  const entityId = validUuid(input.entityId);
  const targetStudioId = validUuid(input.targetStudioId);
  if (!entityId || !targetStudioId || targetStudioId !== input.currentStudioId) return null;
  return new Set(input.availableEntityIds).has(entityId) ? entityId : null;
}

function withScopedEntity(path: string, key: string, entityId: string, studioId: string) {
  const params = new URLSearchParams({ [key]: entityId, studio: studioId });
  return `${path}?${params.toString()}`;
}

function sanitizeAdminPath(value: string | null | undefined, fallback: string) {
  if (!value?.startsWith("/admin")) return fallback;
  try {
    const parsed = new URL(value, "https://bellza.pt");
    const allowedPath = parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/");
    return parsed.origin === "https://bellza.pt" && allowedPath && !parsed.hash
      ? `${parsed.pathname}${parsed.search}`
      : fallback;
  } catch {
    return fallback;
  }
}

function defaultNotificationPath(kind: string) {
  if (kind === "payment_confirmed" || kind === "payment_failed" || kind === "withdrawal_requested") {
    return "/admin/recebimento";
  }
  if (kind === "new_client" || kind === "new_review") return "/admin/clientes";
  if (kind === "refund_request") return "/admin/politicas";
  if (kind.includes("appointment") || kind === "attendance_confirmation" || kind === "attendance_summary") {
    return "/admin/agenda";
  }
  return "/admin";
}

function validUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function readPayloadString(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
