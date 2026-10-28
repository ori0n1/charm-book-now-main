import { getAdminClient } from "@/lib/supabase-admin.server";
import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";
import {
  dispatchPendingClientCenterPushNotifications,
  dispatchPendingClientPushNotifications,
} from "@/lib/public-client.functions";

export async function dispatchDueAppointmentLifecycle() {
  const sb = getAdminClient() as any;
  const { data: advanceReminders, error: advanceError } = await sb.rpc("enqueue_24h_appointment_push_reminders");
  if (advanceError && advanceError.code !== "PGRST202") throw new Error(advanceError.message);
  const { data, error } = await sb.rpc("enqueue_due_appointment_lifecycle_notifications");
  let queued = data ?? {};
  if (error) {
    if (error.code === "PGRST202" || String(error.message).includes("Could not find")) {
      queued = { skipped: "appointment_lifecycle_rpc_missing" };
    } else {
      throw new Error(error.message);
    }
  }

  const studioPushPromise = dispatchPendingStudioPushNotifications();
  // Client derived notifications can dispatch immediately. Finish that pass before
  // reconciling the center outbox so two workers cannot send the same row concurrently.
  const clientDerived = await dispatchPendingClientPushNotifications();
  const clientCenterPush = await dispatchPendingClientCenterPushNotifications();
  const studioPush = await studioPushPromise;
  return { queued, advanceReminders: advanceReminders ?? null, studioPush, clientDerived, clientCenterPush };
}
