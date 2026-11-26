export const notificationCategories = [
  { id: "new_appointments", label: "Novos agendamentos" },
  { id: "reschedules", label: "Remarcações" },
  { id: "cancellations", label: "Cancelamentos" },
  { id: "pending", label: "Pendências a resolver" },
  { id: "payments", label: "Pagamentos" },
  { id: "reminders", label: "Lembretes" },
  { id: "clients", label: "Novos clientes" },
  { id: "reviews", label: "Avaliações" },
  { id: "other", label: "Outras notificações" },
] as const;

export type NotificationCategory = (typeof notificationCategories)[number]["id"];

const kindCategories: Record<string, NotificationCategory> = {
  new_appointment: "new_appointments",
  appointment_rescheduled: "reschedules",
  appointment_cancelled: "cancellations",
  attendance_confirmation: "pending",
  attendance_summary: "pending",
  critical_request: "pending",
  payment_confirmed: "payments",
  payment_failed: "payments",
  refund_request: "payments",
  withdrawal_requested: "payments",
  appointment_reminder: "reminders",
  new_client: "clients",
  new_review: "reviews",
};

export function notificationCategoryForKind(kind: string): NotificationCategory {
  return kindCategories[kind] ?? "other";
}

export function isNotificationCategory(value: string): value is NotificationCategory {
  return notificationCategories.some((category) => category.id === value);
}

export function disabledNotificationKinds(categories: Iterable<string>): string[] {
  const disabled = new Set(categories);
  return Object.entries(kindCategories)
    .filter(([, category]) => disabled.has(category))
    .map(([kind]) => kind);
}
