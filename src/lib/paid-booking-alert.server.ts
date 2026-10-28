import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";

export async function notifyPaidBookingRequiresReview(
  sb: any,
  input: { studioId: string; bookingRequestId: string; paymentId: string },
  options: { dispatchPush?: boolean } = {},
) {
  const { error } = await sb.rpc("insert_studio_notification", {
    p_studio_id: input.studioId,
    p_kind: "critical_request",
    p_title: "Pagamento confirmado sem marcação",
    p_body: "O sinal foi pago, mas a marcação não pôde ser confirmada. Verifique o pedido e contacte o cliente antes de atribuir outro horário.",
    p_payload: {
      booking_request_id: input.bookingRequestId,
      payment_intent_id: input.paymentId,
      event_key: `paid-booking-review:${input.paymentId}`,
      action_url: "/admin/agenda",
    },
  });
  if (error) throw error;
  // The reconciliation cron runs on the Workers Free plan. Its 50 external
  // subrequest budget cannot also carry a studio-wide push fanout. The
  // existing five-minute lifecycle job dispatches these persisted deliveries.
  if (options.dispatchPush !== false) {
    await dispatchPendingStudioPushNotifications({ studioId: input.studioId });
  }
}
