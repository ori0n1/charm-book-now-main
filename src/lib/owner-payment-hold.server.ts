import { createStripeClient, getConfiguredStripeEnv } from "@/lib/stripe.server";

type Assignment = { serviceId: string; staffId: string };
type OwnerFit = {
  studioId: string;
  assignments: Assignment[];
  startsAt: string;
  confirmOverlap: boolean;
  expectedConflictIds: string[];
  expectedPaymentHoldIds: string[];
};

export async function releaseOwnerPaymentHolds(sb: any, userId: string, fit: OwnerFit) {
  const { data: roles, error: roleError } = await sb
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("studio_id", fit.studioId)
    .in("role", ["studio_owner", "saas_owner"]);
  if (roleError || !roles?.length) throw new Error("Sem permissão para substituir esta reserva.");

  const expectedIds = [...new Set(fit.expectedPaymentHoldIds)].sort();
  if (!expectedIds.length || expectedIds.length !== fit.expectedPaymentHoldIds.length) {
    throw new Error("A reserva de pagamento mudou. Verifique o horário novamente.");
  }
  const serviceIds = fit.assignments.map((item) => item.serviceId);
  const staffIds = fit.assignments.map((item) => item.staffId);
  const [{ data: services, error: serviceError }, { data: staffServices, error: staffServiceError }] =
    await Promise.all([
      sb.from("services").select("id,duration_min").eq("studio_id", fit.studioId)
        .eq("is_active", true).in("id", serviceIds),
      sb.from("staff_services").select("staff_id,service_id")
        .in("staff_id", staffIds).in("service_id", serviceIds),
    ]);
  if (serviceError || staffServiceError) throw new Error("Não foi possível verificar os serviços.");
  const durations = new Map<string, number>((services ?? []).map(
    (service: { id: string; duration_min: number }) => [service.id, service.duration_min],
  ));
  const allowedPairs = new Set<string>((staffServices ?? []).map(
    (pair: { staff_id: string; service_id: string }) => `${pair.staff_id}:${pair.service_id}`,
  ));
  let cursor = new Date(fit.startsAt).getTime();
  const segments = fit.assignments.map((assignment) => {
    const duration = durations.get(assignment.serviceId);
    if (!duration || !allowedPairs.has(`${assignment.staffId}:${assignment.serviceId}`)) {
      throw new Error("A profissional não realiza um dos serviços selecionados.");
    }
    const segment = {
      staffId: assignment.staffId,
      startsAt: new Date(cursor).toISOString(),
      endsAt: new Date(cursor + duration * 60_000).toISOString(),
      durationMin: duration,
    };
    cursor += duration * 60_000;
    return segment;
  });

  const previews = await Promise.all(segments.map((segment) => sb.rpc(
    "preview_studio_schedule_change", {
      p_studio_id: fit.studioId,
      p_staff_id: segment.staffId,
      p_starts_at: segment.startsAt,
      p_duration_min: segment.durationMin,
      p_ignore_appointment_ids: [],
    },
  )));
  if (previews.some((result: any) => result.error || !result.data)) {
    throw new Error("Não foi possível verificar o horário.");
  }
  const actualIds = [...new Set(previews.flatMap((result: any) =>
    result.data.paymentHolds.map((hold: { requestId: string }) => hold.requestId),
  ))].sort();
  if (actualIds.join() !== expectedIds.join()) {
    throw new Error("A reserva de pagamento mudou. Verifique o horário novamente.");
  }
  const conflictIds = [...new Set(previews.flatMap((result: any) =>
    result.data.conflicts.map((conflict: { appointmentId: string }) => conflict.appointmentId),
  ))].sort();
  if ((conflictIds.length > 0 && !fit.confirmOverlap) ||
      (fit.confirmOverlap && conflictIds.join() !== [...fit.expectedConflictIds].sort().join())) {
    throw new Error("As marcações deste horário mudaram. Verifique a agenda novamente.");
  }

  const { data: holds, error: holdError } = await sb.from("booking_payment_requests")
    .select("id,studio_id,status").in("id", expectedIds);
  if (holdError || holds?.length !== expectedIds.length || holds.some((hold: any) =>
    hold.studio_id !== fit.studioId || !["awaiting_payment", "processing"].includes(hold.status)
  )) throw new Error("A reserva de pagamento mudou. Verifique o horário novamente.");

  const { data: payments, error: paymentError } = await sb.from("payment_intents")
    .select("status,stripe_checkout_session_id,stripe_connect_account_id")
    .in("booking_request_id", expectedIds);
  if (paymentError) throw new Error("Não foi possível verificar o pagamento.");
  if (payments?.some((payment: any) => payment.status === "succeeded")) {
    throw new Error("O pagamento já foi concluído. Atualize a agenda.");
  }
  const checkoutPayments = (payments ?? []).filter((payment: any) => payment.stripe_checkout_session_id);
  if (checkoutPayments.length) {
    const stripe = createStripeClient(getConfiguredStripeEnv());
    for (const payment of checkoutPayments) {
      const options = payment.stripe_connect_account_id
        ? { stripeAccount: payment.stripe_connect_account_id } : undefined;
      const session = await stripe.checkout.sessions.retrieve(
        payment.stripe_checkout_session_id, {}, options,
      );
      if (session.status === "complete" || session.payment_status === "paid") {
        throw new Error("O pagamento já foi concluído. Atualize a agenda.");
      }
      if (session.status === "open") {
        try {
          await stripe.checkout.sessions.expire(payment.stripe_checkout_session_id, {}, options);
        } catch {
          throw new Error("O checkout mudou durante a operação. Atualize a agenda.");
        }
      }
    }
  }

  const { error: releaseError } = await sb.rpc("release_unpaid_booking_holds_for_owner_fit", {
    p_studio_id: fit.studioId,
    p_segments: segments.map(({ staffId, startsAt, endsAt }) => ({ staffId, startsAt, endsAt })),
    p_actor_id: userId,
    p_expected_request_ids: expectedIds,
  });
  if (releaseError) {
    const refreshed = await Promise.all(segments.map((segment) => sb.rpc(
      "preview_studio_schedule_change", {
        p_studio_id: fit.studioId,
        p_staff_id: segment.staffId,
        p_starts_at: segment.startsAt,
        p_duration_min: segment.durationMin,
        p_ignore_appointment_ids: [],
      },
    )));
    if (refreshed.every((result: any) =>
      !result.error && result.data && !result.data.paymentHolds?.length
    )) return;
    throw new Error("O estado do pagamento mudou. Atualize a agenda antes de tentar novamente.");
  }
}
