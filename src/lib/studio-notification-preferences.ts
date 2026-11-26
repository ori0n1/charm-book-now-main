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

export function notificationRecipientRole(roles: Iterable<string>): string | undefined {
  const assigned = new Set(roles);
  return ["saas_owner", "studio_owner", "manager", "staff", "desk_staff"]
    .find((role) => assigned.has(role));
}

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

export async function isRecipientNotificationCategoryDisabled(
  sb: { from: (table: string) => any },
  input: { studioId: string; userId: string; kind: string; role: string },
): Promise<boolean> {
  if (input.role !== "studio_owner" && input.role !== "saas_owner") return false;
  const { data, error } = await sb.from("studio_notification_preferences")
    .select("enabled")
    .eq("studio_id", input.studioId)
    .eq("user_id", input.userId)
    .eq("category", notificationCategoryForKind(input.kind))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.enabled === false;
}
