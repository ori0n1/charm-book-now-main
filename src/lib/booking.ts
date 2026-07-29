import { supabase } from "@/integrations/supabase/client";

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

export async function createPublicBooking(input: CreateBookingInput): Promise<BookingResult> {
  const startsAtIso =
    input.startsAt instanceof Date ? input.startsAt.toISOString() : input.startsAt;
  const clientName = input.clientName.trim();
  const clientPhone = normalizeClientPhone(input.clientPhone);
  const clientEmail = input.clientEmail?.trim().toLowerCase() || undefined;
  const { data, error } = await (supabase as any).rpc("create_public_booking", {
    p_studio_slug: input.studioSlug,
    p_staff_id: input.staffDbId,
    p_starts_at: startsAtIso,
    p_service_ids: input.serviceDbIds,
    p_client_name: clientName,
    p_client_phone: clientPhone,
    p_client_email: clientEmail,
    p_notes: input.notes ?? undefined,
    p_customer_referral_code: input.customerReferralCode ?? undefined,
  });
  if (error) {
    console.error("[public-booking] create_public_booking failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      studioSlug: input.studioSlug,
      staffDbId: input.staffDbId,
      serviceDbIds: input.serviceDbIds,
      startsAt: startsAtIso,
      clientPhoneFingerprint: fingerprintPhone(clientPhone),
    });
    throw new Error(
      translateBookingError(
        [error.message, error.details, error.hint, error.code].filter(Boolean).join(" "),
      ),
    );
  }
  const result = data as unknown as BookingResult;
  if (input.policyAcceptance) {
    await recordPolicyAcceptance(input.policyAcceptance, result).catch((error) => {
      console.error("[public-booking] policy acceptance failed", error);
    });
  }
  return result;
}

function normalizeClientPhone(value: string) {
  return value
    .trim()
    .replace(/[^\d+\s]/g, "")
    .replace(/\s+/g, " ");
}

function fingerprintPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `***${digits.slice(-4)}`;
}

async function recordPolicyAcceptance(
  acceptance: NonNullable<CreateBookingInput["policyAcceptance"]>,
  result: BookingResult,
) {
  const { error } = await supabase.rpc("record_public_policy_acceptance", {
    p_studio_id: acceptance.studioId,
    p_booking_request_id: result.booking_request_id,
    p_appointment_id: result.appointment_id,
    p_policy_version: acceptance.policyVersion,
    p_payload: {
      cancellation_notice_hours: acceptance.cancellationNoticeHours,
      after_deadline_policy: acceptance.afterDeadlinePolicy,
      accepted_label: "Li e concordo com as políticas de cancelamento e pagamento.",
    },
  });
  if (error) throw new Error("Não foi possível registar a aceitação das políticas.");
}

function translateBookingError(msg: string): string {
  msg = msg.toLowerCase();
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
