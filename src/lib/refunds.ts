import { supabase } from "@/integrations/supabase/client";

export async function submitRefundRequest(input: {
  bookingRequestId?: string | null;
  appointmentId?: string | null;
  reason: string;
}) {
  const { data, error } = await supabase.rpc("submit_public_refund_request", {
    p_booking_request_id: input.bookingRequestId ?? null,
    p_appointment_id: input.appointmentId ?? null,
    p_reason: input.reason,
  });
  if (error) {
    if (error.message.includes("refund_requests_disabled")) {
      throw new Error("Este estúdio não aceita pedidos de reembolso pela página pública.");
    }
    if (error.message.includes("refund_reason_required")) {
      throw new Error("Indique o motivo do pedido de reembolso.");
    }
    throw new Error("Não foi possível enviar o pedido de reembolso.");
  }
  return data as string;
}
