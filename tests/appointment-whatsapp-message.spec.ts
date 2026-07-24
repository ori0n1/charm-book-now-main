import { expect, test } from "@playwright/test";
import {
  buildPastAppointmentWhatsAppMessage,
  buildWhatsAppComposeUrl,
  isPastAppointment,
} from "../src/lib/appointment-whatsapp-message";

const base = {
  clientName: "Ana",
  studioName: "Bellza Studio",
  bookingUrl: "https://bellza.pt/s/bellza",
  serviceName: "Manicure",
  startsAt: "2026-07-07T13:00:00.000Z",
  endsAt: "2026-07-07T14:00:00.000Z",
};

test("recognizes an appointment only after its end time", () => {
  expect(isPastAppointment(base.endsAt, new Date("2026-07-07T14:00:00.000Z"))).toBe(true);
  expect(isPastAppointment(base.endsAt, new Date("2026-07-07T13:30:00.000Z"))).toBe(false);
});

test("personalizes follow-up messages for the appointment outcome", () => {
  expect(buildPastAppointmentWhatsAppMessage({ ...base, status: "completed" })).toContain(
    "Esperamos que tenha gostado",
  );
  expect(buildPastAppointmentWhatsAppMessage({ ...base, status: "no_show" })).toContain(
    "Sentimos a sua falta",
  );
  expect(buildPastAppointmentWhatsAppMessage({ ...base, status: "cancelled" })).toContain(
    "foi cancelada",
  );
  expect(buildPastAppointmentWhatsAppMessage({ ...base, status: "confirmed" })).toContain(
    "já passou",
  );
});

test("builds a WhatsApp compose link with international digits and encoded text", () => {
  const url = buildWhatsAppComposeUrl("+351 910 000 000", "Olá Ana!");
  expect(url).toBe("https://wa.me/351910000000?text=Ol%C3%A1%20Ana!");
  expect(buildWhatsAppComposeUrl("", "Olá")).toBeNull();
});
