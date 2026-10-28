export type AraraBookingKind = "confirmation" | "cancellation" | "reminder_2h";

export const ARARA_BOOKING_TEMPLATES: Record<AraraBookingKind, string> = {
  confirmation: "booking_confirmation",
  cancellation: "booking_cancellation_v2",
  reminder_2h: "booking_reminder_2h_v2",
};

export type AraraBookingDetails = {
  clientName: string;
  studioName: string;
  serviceName: string;
  date: string;
  time: string;
  reservationUrl: string;
};

export class AraraSendError extends Error {
  readonly safeToFallback: boolean;
  readonly messageId: string | null;
  readonly acceptanceUnknown: boolean;

  constructor(
    message: string,
    safeToFallback: boolean,
    messageId: string | null = null,
    acceptanceUnknown = false,
  ) {
    super(message);
    this.name = "AraraSendError";
    this.safeToFallback = safeToFallback;
    this.messageId = messageId;
    this.acceptanceUnknown = acceptanceUnknown;
  }
}

export function buildAraraBookingTemplate(kind: AraraBookingKind, details: AraraBookingDetails) {
  const values = [
    details.clientName,
    details.studioName,
    details.serviceName,
    details.date,
    details.time,
  ].map((value) => String(value ?? "").trim());
  if (values.some((value) => !value || value.length > 200)) {
    throw new AraraSendError("arara_booking_details_missing_or_invalid", false);
  }
  const match = /^https:\/\/bellza\.pt\/r\/([a-zA-Z0-9_-]+)$/.exec(details.reservationUrl);
  if (!match) throw new AraraSendError("arara_booking_url_invalid", false);
  return {
    templateName: ARARA_BOOKING_TEMPLATES[kind],
    // The sixth variable is the dynamic URL suffix, not a second full URL.
    templateVariables: [...values, match[1]],
  };
}

export async function sendAraraBookingTemplate(input: {
  apiKey: string;
  receiver: string;
  kind: AraraBookingKind;
  details: AraraBookingDetails;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}) {
  const { templateName, templateVariables } = buildAraraBookingTemplate(input.kind, input.details);
  if (!input.apiKey) throw new AraraSendError("arara_api_key_missing", true);
  if (!/^\+[1-9]\d{8,14}$/.test(input.receiver)) {
    throw new AraraSendError("arara_recipient_invalid", false);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://api.ararahq.com/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({ receiver: `whatsapp:${input.receiver}`, templateName, templateVariables }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // A timeout can happen after acceptance. Sending via a second provider here
    // could deliver two WhatsApp messages for the same appointment.
    throw new AraraSendError("arara_acceptance_unknown", false, null, true);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 409 || response.status === 429 || response.status >= 500) {
      throw new AraraSendError("arara_acceptance_unknown", false, null, true);
    }
    const code = String(payload?.error?.code ?? `HTTP_${response.status}`).slice(0, 80);
    const safeToFallback = code !== "RECIPIENT_OPTED_OUT" &&
      ([401, 402, 403].includes(response.status) ||
      (response.status === 422 && [
        "TEMPLATE_NOT_SENDABLE", "TEMPLATE_PAUSED", "TEMPLATE_VARIABLES_MISMATCH",
      ].includes(code)));
    throw new AraraSendError(
      `arara_${code}`,
      safeToFallback,
    );
  }
  const returnedId = payload?.id ?? payload?.data?.id;
  const messageId = typeof returnedId === "string" ? returnedId : null;
  if (!messageId) throw new AraraSendError("arara_acceptance_unknown", false, null, true);
  return { messageId, status: String(payload?.status ?? payload?.data?.status ?? "PENDING").toUpperCase() };
}

export async function getAraraMessageStatus(input: {
  apiKey: string;
  messageId: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.ararahq.com/api/v1/messages/${encodeURIComponent(input.messageId)}`,
    {
      headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error(`arara_status_http_${response.status}`);
  const payload = await response.json();
  return String(payload?.status ?? payload?.data?.status ?? "PENDING").toUpperCase();
}
