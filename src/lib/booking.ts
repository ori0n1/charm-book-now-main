export type CreateBookingInput = {
  studioSlug: string;
  staffDbId: string;
  startsAt: Date | string;
  serviceDbIds: string[];
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  notes?: string;
  customerReferralCode?: string;
  policyAcceptance?: {
    studioId: string;
    policyVersion: string;
    cancellationNoticeHours: number;
    afterDeadlinePolicy: string;
  };
};

export type BookingResult = {
  appointment_id: string | null;
  booking_request_id: string | null;
  studio_id: string;
  starts_at: string;
  ends_at: string;
  total_price: number;
  total_duration_min: number;
  requires_payment: boolean;
  reservation_status?: string;
  payment_status?: string;
};

export type BookingQuote = {
  studio_id: string;
  total_price: number;
  total_duration_min: number;
  lines: Array<{
    service_id: string;
    price: number;
    duration_min: number;
    is_upsell: boolean;
  }>;
};

export function validateBookingQuote(value: unknown): BookingQuote {
  if (!value || typeof value !== "object") throw invalidBookingConfirmation();
  const quote = value as Partial<BookingQuote>;
  const totalPrice = Number(quote.total_price);
  const totalDuration = Number(quote.total_duration_min);
  if (!cleanBackendId(quote.studio_id)) throw invalidBookingConfirmation();
  if (!Number.isFinite(totalPrice) || totalPrice < 0) throw invalidBookingConfirmation();
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) throw invalidBookingConfirmation();
  if (!Array.isArray(quote.lines) || quote.lines.length === 0) throw invalidBookingConfirmation();
  return {
    ...(quote as BookingQuote),
    total_price: Math.round(totalPrice * 100) / 100,
    total_duration_min: Math.round(totalDuration),
  };
}

export function validateConfirmedBookingResult(value: unknown): BookingResult {
  if (!value || typeof value !== "object") throw invalidBookingConfirmation();
  const result = value as Partial<BookingResult>;
  const appointmentId = cleanBackendId(result.appointment_id);
  const bookingRequestId = cleanBackendId(result.booking_request_id);
  const studioId = cleanBackendId(result.studio_id);

  if (typeof result.requires_payment !== "boolean") throw invalidBookingConfirmation();
  if (!studioId) throw invalidBookingConfirmation();
  const totalPrice = Number(result.total_price);
  const totalDuration = Number(result.total_duration_min);
  const startsAt = normalizeBackendInstant(result.starts_at);
  const endsAt = normalizeBackendInstant(result.ends_at);
  if (!Number.isFinite(totalPrice) || totalPrice < 0) throw invalidBookingConfirmation();
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) throw invalidBookingConfirmation();
  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw invalidBookingConfirmation();
  }
  if (result.requires_payment) {
    if (!appointmentId && !bookingRequestId) throw invalidBookingConfirmation();
  } else if (!appointmentId) {
    // A non-payment booking is only confirmed after the database has created
    // the appointment and returned its immutable identifier.
    throw invalidBookingConfirmation();
  }

  return {
    ...(result as BookingResult),
    appointment_id: appointmentId,
    booking_request_id: bookingRequestId,
    studio_id: studioId,
    starts_at: startsAt,
    ends_at: endsAt,
    // Values returned by the booking RPC are the financial snapshot. Normalise
    // them once here so confirmed screens never fall back to a browser total.
    total_price: Math.round(totalPrice * 100) / 100,
    total_duration_min: Math.round(totalDuration),
  };
}

function normalizeBackendInstant(value: unknown) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function cleanBackendId(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

function invalidBookingConfirmation() {
  console.error("[public-booking] invalid confirmation payload");
  return new Error("Não foi possível confirmar a reserva. Atualize a página e tente novamente.");
}

export function translateBookingError(msg: string): string {
  msg = msg.toLowerCase();
  if (msg.includes("booking_request_mode_only"))
    return "Este estúdio recebe solicitações pelo WhatsApp. Escolha as preferências e envie o pedido ao estúdio.";
  if (msg.includes("duplicate key"))
    return "Este horário acabou de ser reservado. Escolha outro, por favor.";
  if (msg.includes("permission denied") || msg.includes("row-level security"))
    return "Não foi possível validar esta reserva. Atualize a página e tente novamente.";
  if (msg.includes("could not find the function") || msg.includes("schema cache"))
    return "A reserva não pôde ser preparada agora. Atualize a página e tente novamente.";
  if (msg.includes("payment_intents_method_no_new_multibanco"))
    return "Estamos a limpar pagamentos antigos. Atualize a página e tente novamente.";
  if (msg.includes("booking_too_soon"))
    return "Este horário já não está disponível para marcação imediata.";
  if (msg.includes("slot_unavailable"))
    return "Este horário acabou de ser reservado. Escolha outro, por favor.";
  if (msg.includes("booking_request_expired"))
    return "A reserva temporária expirou. Escolha novamente o horário para garantir disponibilidade.";
  if (msg.includes("outside_hours")) return "O estúdio está fechado neste horário. Escolha outro.";
  if (msg.includes("staff_off"))
    return "A profissional está de folga neste período. Escolha outro horário.";
  if (msg.includes("staff_cannot_perform_service"))
    return "A profissional selecionada não realiza todos os serviços escolhidos. Escolha outra profissional ou remova extras.";
  if (msg.includes("client_suspended"))
    return "Este cliente está temporariamente impedido de fazer novas marcações. Entre em contacto com o estúdio.";
  if (msg.includes("client_blocked"))
    return "Este cliente não pode realizar novas marcações. Entre em contacto com o estúdio.";
  if (msg.includes("invalid_phone")) return "Telemóvel inválido. Verifique o número.";
  if (msg.includes("invalid_name")) return "Nome inválido. Mínimo 2 letras.";
  if (msg.includes("studio_not_found")) return "Estúdio não encontrado.";
  if (msg.includes("studio_not_available"))
    return "Este estúdio não está disponível para novas reservas neste momento. Contacte o estúdio.";
  if (msg.includes("staff_not_found")) return "Profissional indisponível.";
  if (msg.includes("invalid_services"))
    return "Adicione pelo menos um serviço com duração para escolher um horário.";
  if (msg.includes("no_services")) return "Escolha pelo menos um serviço.";
  if (msg.includes("payment_not_succeeded"))
    return "O pagamento ainda não foi confirmado. Aguarde a confirmação ou tente novamente.";
  return "Não foi possível concluir a reserva. Tente novamente em instantes.";
}
