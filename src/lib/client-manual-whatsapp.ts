import { formatStudioDate, formatStudioTime } from "./studio-time.ts";

export const INACTIVE_CLIENT_DAYS = 30;
export const NEAR_APPOINTMENT_HOURS = 2;

export type ManualWhatsAppClient = {
  name: string;
  bookingStatus: string;
  completedAppointments: number;
  daysSinceLastVisit: number | null;
  hasFutureBooking: boolean;
  nextAppointment: { startsAt: string; service: string } | null;
};

export function isInactiveClient(client: ManualWhatsAppClient) {
  return client.bookingStatus === "active" && !client.hasFutureBooking &&
    client.completedAppointments > 0 && (client.daysSinceLastVisit ?? 0) >= INACTIVE_CLIENT_DAYS;
}

export function isNearAppointment(client: ManualWhatsAppClient, now = Date.now()) {
  const startsAt = client.nextAppointment ? Date.parse(client.nextAppointment.startsAt) : NaN;
  return Number.isFinite(startsAt) && startsAt >= now && startsAt <= now + NEAR_APPOINTMENT_HOURS * 3_600_000;
}

export function buildClientWhatsAppMessage(
  client: ManualWhatsAppClient,
  returnDelayDays: number,
  studioName?: string | null,
  studioTimezone?: string | null,
  now = Date.now(),
) {
  const name = client.name.trim();
  const greeting = name ? `Olá, ${name}!` : "Olá!";
  const studioText = studioName?.trim() ? ` da ${studioName.trim()}` : " do estúdio";
  if (isNearAppointment(client, now) && client.nextAppointment) {
    const time = formatStudioTime(client.nextAppointment.startsAt, studioTimezone);
    const date = formatStudioDate(client.nextAppointment.startsAt, studioTimezone);
    return `${greeting} Passamos para recordar a sua marcação${studioText} no dia ${date} às ${time} para ${client.nextAppointment.service}. Até breve!`;
  }
  if (returnDelayDays > 0 || isInactiveClient(client)) {
    const quantityText = returnDelayDays === 1
      ? "já passou 1 dia da sua previsão de retorno"
      : `já se passaram ${returnDelayDays} dias da sua previsão de retorno`;
    const returnText = returnDelayDays > 0 ? `Percebemos que ${quantityText}. ` : "Já há algum tempo que não nos visita. ";
    return `${greeting} Tudo bem? 😊\n${returnText}Sentimos a sua falta${studioText} e gostaríamos de saber se deseja marcar um novo horário.`;
  }
  return `${greeting} Tudo bem? 😊 Sentimos a sua falta e gostaríamos de saber se deseja marcar um novo horário conosco.`;
}
