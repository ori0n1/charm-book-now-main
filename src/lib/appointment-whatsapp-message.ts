export type PastAppointmentWhatsAppInput = {
  clientName: string;
  studioName: string;
  bookingUrl: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
};

export function isPastAppointment(endsAt: string, now = new Date()) {
  const end = new Date(endsAt).getTime();
  return Number.isFinite(end) && end <= now.getTime();
}

export function buildPastAppointmentWhatsAppMessage(input: PastAppointmentWhatsAppInput) {
  const clientName = input.clientName.trim() || "cliente";
  const studioName = input.studioName.trim() || "o estúdio";
  const serviceName = input.serviceName.trim() || "atendimento";
  const startsAt = new Date(input.startsAt);
  const date = startsAt.toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Lisbon",
  });
  const time = startsAt.toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Lisbon",
  });
  const bookingLine = input.bookingUrl.trim()
    ? `\n\nPode escolher uma nova data aqui: ${input.bookingUrl.trim()}`
    : "";

  if (input.status === "completed") {
    return `Olá ${clientName}! Esperamos que tenha gostado do seu atendimento de ${serviceName} no ${studioName}, no dia ${date}. Quando quiser, teremos todo o gosto em recebê-la novamente.${bookingLine}`;
  }
  if (input.status === "no_show") {
    return `Olá ${clientName}! Sentimos a sua falta na marcação de ${serviceName} no ${studioName}, prevista para ${date} às ${time}. Gostaria de reagendar?${bookingLine}`;
  }
  if (input.status === "cancelled") {
    return `Olá ${clientName}! A sua marcação de ${serviceName} no ${studioName}, prevista para ${date} às ${time}, foi cancelada. Quando desejar, pode escolher uma nova data.${bookingLine}`;
  }
  return `Olá ${clientName}! A sua marcação de ${serviceName} no ${studioName}, prevista para ${date} às ${time}, já passou. Gostaria de reagendar?${bookingLine}`;
}

export function buildWhatsAppComposeUrl(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
