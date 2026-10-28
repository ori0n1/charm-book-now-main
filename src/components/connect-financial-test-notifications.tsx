import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type FinancialNotice = { id: string; body: string; createdAt: string; status?: string };
const TEST_TENANT = "6209a9f0-f0f1-4b5c-a35e-d111f425ddc2";
const TEST_ORIGIN = "https://tanstack-start-app-staging.silas18-so.workers.dev";
const ENDPOINT = "https://bellza-connect-financial-test.silas18-so.workers.dev/notifications/financial";

const LIVE_TENANT = "99f2ab87-589e-4019-a855-0aafc8b9056c";
// Build-time opt-in stays absent/off in all existing deployments.
const LIVE_ENABLED = import.meta.env?.VITE_CONNECT_FINANCIAL_LIVE_ENABLED === "true";
const LIVE_ORIGIN = import.meta.env?.VITE_CONNECT_FINANCIAL_LIVE_APP_ORIGIN as string | undefined;
const LIVE_ENDPOINT = import.meta.env?.VITE_CONNECT_FINANCIAL_LIVE_ENDPOINT as string | undefined;
// Separate in-app view. Never imports push, e-mail, WhatsApp or existing notification dispatch.
export function ConnectFinancialTestNotifications({ studioId }: { studioId: string }) {
  const [items, setItems] = useState<FinancialNotice[]>([]);
  useEffect(() => {
    setItems([]);
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
        if (!controller.signal.aborted) setItems(Array.isArray(result.items) ? result.items : []);
      } catch { if (!controller.signal.aborted) setItems([]); }
      finally { loading = false; }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [studioId]);
  if (!items.length) return null;
  return (
    <details className="static shrink-0 text-sm lg:relative">
      <summary aria-label={`Notificações financeiras (${items.length})`} className="flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-xl border p-2 [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4"><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" /></svg>
        <span className="sr-only lg:not-sr-only">Notificações financeiras ({items.length})</span>
        <span aria-hidden="true" className="lg:hidden">{items.length}</span>
      </summary>
      <ul aria-label="Notificações financeiras" className="absolute inset-x-4 top-full z-50 mt-2 w-auto max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg lg:left-auto lg:right-0 lg:top-auto lg:w-72">
        {items.map((item) => <li key={item.id} className="break-words">{item.body}</li>)}
      </ul>
    </details>
  );
}
