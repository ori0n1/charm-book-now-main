import { expect, test } from "@playwright/test";
import {
  SENDDM_BOOKING_CONFIRMATION_PARAMETERS,
  buildSendDmWhatsAppPayload,
  classifySendDmWhatsAppDelivery,
  readSendDmChannel,
  readSendDmMessageId,
  validateSendDmTemplateParameters,
  type SendDmTemplateParameters,
} from "../src/lib/senddm-whatsapp";

const parameters: SendDmTemplateParameters = {
  nomeCliente: "Ana",
  data: "24/07/2026",
  hora: "14:30",
  servico: "Manicure",
  profissional: "Maria",
  orderId: "ABC123",
};

test("builds a WhatsApp-only v3 request with the template id", () => {
  const payload = buildSendDmWhatsAppPayload({
    to: "+351910000000",
    templateId: "template-id",
    parameters,
    metadata: { source: "bellza" },
  });

  expect(payload.channel).toEqual(["whatsapp"]);
  expect(payload.template).toEqual({
    id: "template-id",
    parameters,
  });
  expect(payload).not.toHaveProperty("from");
});

test("reads the accepted channel and message id from the v3 recipients response", () => {
  const payload = {
    data: {
      status: "QUEUED",
      recipients: [
        {
          message_id: "message-id",
          channel: "whatsapp",
        },
      ],
    },
  };

  expect(readSendDmMessageId(payload)).toBe("message-id");
  expect(readSendDmChannel(payload)).toBe("whatsapp");
  expect(classifySendDmWhatsAppDelivery(payload)).toMatchObject({
    state: "pending",
    channel: "whatsapp",
  });
});

test("rejects an SMS fallback even when the provider reports delivery", () => {
  expect(
    classifySendDmWhatsAppDelivery({
      data: { status: "DELIVERED", channel: "sms" },
    }),
  ).toEqual({
    state: "failed",
    status: "DELIVERED",
    channel: "sms",
    reason: "senddm_channel_mismatch: expected_whatsapp_received_sms",
  });
});

test("does not treat SENT as delivered", () => {
  expect(
    classifySendDmWhatsAppDelivery({
      data: { status: "SENT", channel: "whatsapp" },
    }),
  ).toMatchObject({
    state: "pending",
    reason: "senddm_awaiting_delivery:SENT",
  });
});

test("does not turn a provider-rendered template placeholder into a false failure", () => {
  expect(
    classifySendDmWhatsAppDelivery({
      data: {
        status: "DELIVERED",
        channel: "whatsapp",
        message_body: {
          buttons: [{ value: "https://bellza.pt/r/{{5:variable}}" }],
        },
      },
    }),
  ).toMatchObject({
    state: "delivered",
    reason: null,
  });
});

test("accepts only a complete template parameter set", () => {
  expect(
    validateSendDmTemplateParameters(SENDDM_BOOKING_CONFIRMATION_PARAMETERS, parameters),
  ).toMatchObject({ ok: true, reason: null });

  expect(
    validateSendDmTemplateParameters(SENDDM_BOOKING_CONFIRMATION_PARAMETERS, {
      ...parameters,
      orderId: "",
    }),
  ).toMatchObject({
    ok: false,
    reason: "empty_parameters_6:orderId",
  });
});
