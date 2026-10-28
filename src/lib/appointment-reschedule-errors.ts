const GENERIC_RESCHEDULE_ERROR =
  "Não foi possível remarcar. Tente novamente mais tarde.";

export function getRescheduleUserMessage(
  error: unknown,
  policyBlockReason?: string | null,
) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("slot_unavailable") ||
    normalized.includes("exclusion") ||
    normalized.includes("conflito") ||
    normalized.includes("horário acabou de ficar indisponível")
  ) {
    return "Este horário já não está disponível. Escolha outro horário.";
  }
  if (
    normalized.includes("appointment_not_reschedulable") ||
    normalized.includes("já não pode ser remarcada")
  ) {
    return "Esta marcação já não pode ser remarcada.";
  }
  if (
    normalized.includes("appointment_not_found") ||
    normalized.includes("não encontrámos esta marcação")
  ) {
    return "Não encontrámos esta marcação. Atualize a página e tente novamente.";
  }
  if (
    normalized.includes("invalid_reschedule_datetime") ||
    normalized.includes("invalid datetime")
  ) {
    return "A data ou o horário selecionado não é válido. Escolha novamente.";
  }
  if (
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("permission denied")
  ) {
    return "Não tem permissão para remarcar esta marcação.";
  }
  if (
    policyBlockReason &&
    (message.includes(policyBlockReason) ||
      normalized.includes("prazo") ||
      normalized.includes("antecedência"))
  ) {
    return policyBlockReason;
  }

  return GENERIC_RESCHEDULE_ERROR;
}

