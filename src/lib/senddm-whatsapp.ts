export const SENDDM_BOOKING_CONFIRMATION_PARAMETERS = [
  "nomeCliente",
  "data",
  "hora",
  "servico",
  "profissional",
  "orderId",
] as const;

export type SendDmTemplateParameters = Record<
  (typeof SENDDM_BOOKING_CONFIRMATION_PARAMETERS)[number],
  string
>;

type BuildSendDmPayloadInput = {
  to: string;
  templateId: string;
  parameters: Record<string, string>;
  metadata: Record<string, unknown>;
};

export function buildSendDmWhatsAppPayload(input: BuildSendDmPayloadInput) {
  return {
    to: [input.to],
    channel: ["whatsapp"],
    template: {
      id: input.templateId,
      parameters: input.parameters,
    },
    metadata: input.metadata,
  };
}

export function readSendDmMessageId(payload: any): string | null {
  return (
    payload?.id ??
    payload?.message_id ??
    payload?.messageId ??
    payload?.data?.id ??
    payload?.data?.recipients?.[0]?.message_id ??
    null
  );
}

export function readSendDmStatus(payload: any): string | null {
  return payload?.status ?? payload?.message_status ?? payload?.data?.status ?? null;
}

export function readSendDmChannel(payload: any): string | null {
  const channel =
    payload?.channel ?? payload?.data?.channel ?? payload?.data?.recipients?.[0]?.channel ?? null;
  return typeof channel === "string" ? channel.trim().toLowerCase() : null;
}

export function readSendDmError(payload: any): string {
  const failedEvent = payload?.data?.events?.find?.((event: any) =>
    String(event?.status ?? event?.type ?? "")
      .toUpperCase()
      .includes("FAILED"),
  );
  const reasonCode = payload?.data?.reason_code ?? failedEvent?.reason_code;
  const reason = payload?.data?.reason ?? failedEvent?.reason;
  if (reasonCode || reason) {
    return [reasonCode, reason].filter(Boolean).map(String).join(": ");
  }
  return String(
    payload?.message ??
      payload?.error?.message ??
      payload?.error ??
      payload?.error_message ??
      payload?.data?.error ??
      failedEvent?.description ??
      failedEvent?.message ??
      failedEvent?.reason ??
      "",
  );
}

// Only a confirmed terminal provider failure may receive a new provider key.
// Unknown outcomes keep the original key, so a timeout cannot create a duplicate.
export function sendDmExplicitRetryKey(baseKey: string, log: any, recipientPhone?: string | null): string {
  const response = log?.payload?.response;
  const messageId = String(log?.provider_message_id ?? "").trim();
  const recipientChanged = Boolean(
    recipientPhone &&
    log?.recipient_phone &&
    String(log.recipient_phone).trim() !== recipientPhone,
  );
  if (
    log?.status !== "failed" ||
    !messageId ||
    String(response?.data?.status ?? "").toUpperCase() !== "FAILED" ||
    (!recipientChanged && String(response?.data?.reason_code ?? "").toUpperCase() !== "BUSINESS_017") ||
    String(readSendDmMessageId(response) ?? "") !== messageId
  ) {
    return baseKey;
  }
  return `${baseKey}-retry-${messageId}`;
}

export function readUnresolvedSendDmButtonVariable(payload: any): string {
  const buttons = payload?.data?.message_body?.buttons;
  if (!Array.isArray(buttons)) return "";
  const unresolved = buttons
    .map((button: any) => String(button?.value ?? ""))
    .find((value: string) => /\{\{[^}]+\}\}/.test(value));
  return unresolved ? `button_url_contains_unresolved_variable:${unresolved}` : "";
}

export type SendDmDeliveryClassification = {
  state: "delivered" | "pending" | "failed";
  status: string | null;
  channel: string | null;
  reason: string | null;
};

export function classifySendDmWhatsAppDelivery(payload: any): SendDmDeliveryClassification {
  const status = readSendDmStatus(payload);
  const channel = readSendDmChannel(payload);
  const normalizedStatus = String(status || "").toUpperCase();

  if (channel && channel !== "whatsapp") {
    return {
      state: "failed",
      status,
      channel,
      reason: `senddm_channel_mismatch: expected_whatsapp_received_${channel}`,
    };
  }
  if (["FAILED", "UNDELIVERED", "CANCELLED", "CANCELED", "FILTERED", "BLOCKED"].includes(normalizedStatus)) {
    return {
      state: "failed",
      status,
      channel,
      reason: `senddm_delivery_failed: ${readSendDmError(payload) || "provider_failed"}`,
    };
  }
  if (["DELIVERED", "READ"].includes(normalizedStatus)) {
    return { state: "delivered", status, channel, reason: null };
  }
  return {
    state: "pending",
    status,
    channel,
    reason: `senddm_awaiting_delivery:${normalizedStatus || "UNKNOWN"}`,
  };
}

export function validateSendDmTemplateParameters(
  expectedParameters: readonly string[],
  sentParameters: Record<string, unknown>,
) {
  const sentKeys = Object.keys(sentParameters);
  const parameterState = expectedParameters.map((name, index) => {
    const value = sentParameters[name];
    return {
      index: index + 1,
      name,
      hasValue: typeof value === "string" && value.trim().length > 0,
      length: typeof value === "string" ? value.trim().length : 0,
    };
  });

  if (sentKeys.length !== expectedParameters.length) {
    return {
      ok: false,
      reason: `expected_${expectedParameters.length}_parameters_received_${sentKeys.length}`,
      parameterState,
    };
  }

  const expectedSet = new Set(expectedParameters);
  const extra = sentKeys.filter((key) => !expectedSet.has(key));
  const missingKeys = expectedParameters.filter(
    (key) => !Object.prototype.hasOwnProperty.call(sentParameters, key),
  );
  if (extra.length > 0 || missingKeys.length > 0) {
    return {
      ok: false,
      reason: `parameter_keys_mismatch_missing_${missingKeys.join(",") || "none"}_extra_${extra.join(",") || "none"}`,
      parameterState,
    };
  }

  const missing = parameterState.filter((param) => !param.hasValue);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `empty_parameters_${missing.map((param) => `${param.index}:${param.name}`).join(",")}`,
      parameterState,
    };
  }

  return { ok: true, reason: null, parameterState };
}
