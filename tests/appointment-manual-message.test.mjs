import test from "node:test";
import assert from "node:assert/strict";
import { buildManualAppointmentWhatsAppMessage, buildWhatsAppComposeUrl } from "../src/lib/appointment-whatsapp-message.ts";

const appointment = {
  clientName: "Jaqueline", studioName: "Bellza Centro", serviceName: "Brushing",
  date: "26 de novembro de 2026", time: "09:30",
};

test("confirmação e lembrete manuais mantêm serviço, horário e estúdio na mensagem editável", () => {
  const confirmation = buildManualAppointmentWhatsAppMessage({ ...appointment, purpose: "confirmation" });
  const reminder = buildManualAppointmentWhatsAppMessage({ ...appointment, purpose: "reminder" });
  assert.match(confirmation, /Bellza Centro/);
  assert.match(confirmation, /Brushing/);
  assert.match(confirmation, /26 de novembro de 2026 às 09:30/);
  assert.match(reminder, /Brushing/);
  assert.match(reminder, /hoje às 09:30/);
  assert.match(buildWhatsAppComposeUrl("+351 912 345 678", reminder), /^https:\/\/wa\.me\/351912345678\?text=/);
});
