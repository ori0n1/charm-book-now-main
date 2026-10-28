export const SENDDM_LIFECYCLE_PARAMETERS = [
  "nomeCliente", "data", "hora", "servico", "profissional", "reservaToken",
] as const;

export const SENDDM_LIFECYCLE_TEMPLATES = {
  reschedule: {
    id: "d4a6003c-a3b5-4966-838c-42a6d2dbca89",
    name: "new_template__hachvxqskk",
    title: "Aviso de reserva remarcada",
  },
  cancellation: {
    id: "17b018fc-593c-4d1b-a4cb-1286ee094dc7",
    name: "new_template__vvpxxhwjio",
    title: "Aviso de reserva cancelada",
  },
  reminder_2h: {
    id: "2eb655c0-6495-420b-bcd6-5c235a709160",
    name: "new_template__xlcnzkzehc",
    title: "Lembrete de Reserva 2h",
  },
} as const;

export type SendDmLifecycleKind = keyof typeof SENDDM_LIFECYCLE_TEMPLATES;

export function isSendDmLifecycleKind(kind: string): kind is SendDmLifecycleKind {
  return Object.prototype.hasOwnProperty.call(SENDDM_LIFECYCLE_TEMPLATES, kind);
}

export function buildSendDmLifecycleParameters(
  values: Record<"nomeCliente" | "data" | "hora" | "servico" | "profissional", string>,
  reservationUrl: string,
) {
  let url: URL;
  try {
    url = new URL(reservationUrl);
  } catch {
    throw new Error("senddm_lifecycle_invalid_booking_link");
  }
  if (url.origin !== "https://bellza.pt" ||
      !/^\/r\/[A-Za-z0-9_-]{8,128}$/.test(url.pathname) || url.search || url.hash) {
    throw new Error("senddm_lifecycle_invalid_booking_link");
  }
  const reservaToken = url.pathname.slice("/r/".length);
  return { ...values, reservaToken };
}
