import test from "node:test";
import assert from "node:assert/strict";
import { buildClientWhatsAppMessage, isInactiveClient, isNearAppointment } from "../src/lib/client-manual-whatsapp.ts";

const base = {
  name: "Lucas Silva", bookingStatus: "active", completedAppointments: 2,
  daysSinceLastVisit: 43, hasFutureBooking: false, nextAppointment: null,
};

test("inatividade discreta exige visita anterior e ausência de marcação futura", () => {
  assert.equal(isInactiveClient(base), true);
  assert.equal(isInactiveClient({ ...base, daysSinceLastVisit: 29 }), false);
  assert.equal(isInactiveClient({ ...base, hasFutureBooking: true }), false);
  assert.equal(isInactiveClient({ ...base, completedAppointments: 0 }), false);
});

test("lembrete cobre apenas as duas horas antes da marcação confirmada selecionada", () => {
  const now = Date.parse("2026-11-26T15:00:00Z");
  const client = { ...base, hasFutureBooking: true,
    nextAppointment: { startsAt: "2026-11-26T16:30:00Z", service: "Hidratação capilar" } };
  assert.equal(isNearAppointment(client, now), true);
  assert.equal(isNearAppointment(client, Date.parse("2026-11-26T14:29:00Z")), false);
  assert.equal(isNearAppointment(client, Date.parse("2026-11-26T16:31:00Z")), false);
  assert.match(buildClientWhatsAppMessage(client, 0, "Bellza Centro", "Europe/Lisbon", now),
    /26\/11\/2026 às 16:30 para Hidratação capilar/);
});

test("cliente inativo recebe convite de retorno com nome do estúdio", () => {
  const message = buildClientWhatsAppMessage(base, 0, "Bellza Centro", "Europe/Lisbon");
  assert.match(message, /Olá, Lucas Silva!/);
  assert.match(message, /Já há algum tempo que não nos visita/);
  assert.match(message, /Bellza Centro/);
});
