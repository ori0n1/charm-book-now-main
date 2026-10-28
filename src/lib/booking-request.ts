export type BookingRequestMessageInput = {
  studioWhatsapp: string;
  studioName: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceNames: string[];
  preferredProfessional?: string | null;
  intendedDate: Date;
  intendedTime: string;
  quotedTotal: number;
  notes?: string;
};

export function normalizeWhatsappRecipient(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits.length >= 9 && digits.length <= 15 ? digits : "";
}

export function buildBookingRequestMessage(input: BookingRequestMessageInput) {
  const date = new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(input.intendedDate);
  const total = new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(Math.round(input.quotedTotal * 100) / 100);
  const lines = [
    `Olá, ${input.studioName}! Gostaria de solicitar um agendamento.`,
    "",
    `Serviço(s): ${input.serviceNames.join(" + ")}`,
    ...(input.preferredProfessional
      ? [`Preferência de profissional: ${input.preferredProfessional} (não garantida)`]
      : []),
    `Data pretendida: ${date}`,
    `Horário pretendido: ${input.intendedTime}`,
    `Valor informado: ${total}`,
    `Cliente: ${input.clientName.trim()}`,
    `Contacto: ${input.clientPhone.trim()}`,
    ...(input.clientEmail?.trim() ? [`Email: ${input.clientEmail.trim()}`] : []),
    ...(input.notes?.trim() ? [`Observações: ${input.notes.trim()}`] : []),
    "",
    "Entendo que isto é apenas uma solicitação. A marcação e o horário só ficam confirmados após resposta do estúdio.",
  ];
  return lines.join("\n");
}

export function buildBookingRequestWhatsappUrl(input: BookingRequestMessageInput) {
  const recipient = normalizeWhatsappRecipient(input.studioWhatsapp);
  if (!recipient) throw new Error("O WhatsApp do estúdio não está configurado corretamente.");
  return `https://wa.me/${recipient}?text=${encodeURIComponent(buildBookingRequestMessage(input))}`;
}
