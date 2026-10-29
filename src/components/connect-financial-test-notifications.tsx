import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FinancialNotice = { id: string; body: string; createdAt: string; status?: string };

const TEST_TENANT = "6209a9f0-f0f1-4b5c-a35e-d111f425ddc2";
const TEST_ORIGIN = "https://tanstack-start-app-staging.silas18-so.workers.dev";
const ENDPOINT = "https://bellza-connect-financial-test.silas18-so.workers.dev/notifications/financial";

const LIVE_TENANT = "99f2ab87-589e-4019-a855-0aafc8b9056c";
// Build-time opt-in stays absent/off in all existing deployments.
const LIVE_ENABLED = import.meta.env?.VITE_CONNECT_FINANCIAL_LIVE_ENABLED === "true";
const LIVE_ORIGIN = import.meta.env?.VITE_CONNECT_FINANCIAL_LIVE_APP_ORIGIN as string | undefined;
const LIVE_ENDPOINT = import.meta.env?.VITE_CONNECT_FINANCIAL_LIVE_ENDPOINT as string | undefined;
// Read-only financial notices remain separate from push and notification dispatch.
export function useConnectFinancialNotifications(studioId: string, enabled: boolean) {
  const [items, setItems] = useState<FinancialNotice[]>([]);
  useEffect(() => {
    setItems([]);
    if (!enabled) return;
    const testScope = window.location.origin === TEST_ORIGIN && studioId === TEST_TENANT;
    const liveScope = LIVE_ENABLED && studioId === LIVE_TENANT && window.location.origin === LIVE_ORIGIN && /^https:\/\//.test(LIVE_ENDPOINT ?? "");
    if (!testScope && !liveScope) return;
    const endpoint = testScope ? ENDPOINT : LIVE_ENDPOINT;
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading || controller.signal.aborted) return;
      loading = true;
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { if (!controller.signal.aborted) setItems([]); return; }
        const response = await fetch(`${endpoint}?tenant=${encodeURIComponent(studioId)}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
          cache: "no-store",
        });
        if (!response.ok) { if (!controller.signal.aborted) setItems([]); return; }
        const result = (await response.json()) as { items: FinancialNotice[] };
        if (!controller.signal.aborted) {
          setItems(Array.isArray(result.items)
            ? result.items.filter((item) => typeof item.id === "string" && typeof item.body === "string" && typeof item.createdAt === "string")
            : []);
        }
      } catch { if (!controller.signal.aborted) setItems([]); }
      finally { loading = false; }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [studioId, enabled]);
  return items;
}
