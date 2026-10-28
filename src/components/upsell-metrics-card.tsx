import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Target, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { VisualMoney } from "@/components/visual-money-privacy";

type OfferRow = {
  id: string;
  trigger_service_id: string;
  offered_service_id: string;
  discounted_price: number;
  views_count: number;
  conversions_count: number;
  extra_revenue: number;
  is_active: boolean;
};

type ServiceRow = { id: string; name: string };

export function UpsellMetricsCard({ studioId }: { studioId: string }) {
  const queryClient = useQueryClient();
  const metricsQuery = useQuery({
    queryKey: ["upsell-metrics", studioId],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data: offerData } = await supabase
        .from("upsell_offers")
        .select("id,trigger_service_id,offered_service_id,discounted_price,views_count,conversions_count,extra_revenue,is_active")
        .eq("studio_id", studioId)
        .eq("is_active", true)
        .order("conversions_count", { ascending: false });

      const offerRows = (offerData ?? []) as OfferRow[];
      const ids = Array.from(new Set(offerRows.flatMap((r) => [r.trigger_service_id, r.offered_service_id])));
      let names: Record<string, string> = {};

      if (ids.length > 0) {
        const { data: serviceData } = await supabase.from("services").select("id,name").in("id", ids);
        names = Object.fromEntries(((serviceData ?? []) as ServiceRow[]).map((r) => [r.id, r.name]));
      }

      return { offers: offerRows, serviceNames: names };
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`upsell-metrics-${studioId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "upsell_offers", filter: `studio_id=eq.${studioId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["upsell-metrics", studioId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, studioId]);

  const offers = useMemo(() => metricsQuery.data?.offers ?? [], [metricsQuery.data?.offers]);
  const serviceNames = metricsQuery.data?.serviceNames ?? {};

  const totals = useMemo(() => {
    const views = offers.reduce((sum, offer) => sum + (offer.views_count ?? 0), 0);
    const conversions = offers.reduce((sum, offer) => sum + (offer.conversions_count ?? 0), 0);
    const revenue = offers.reduce((sum, offer) => sum + Number(offer.extra_revenue ?? 0), 0);
    return { views, conversions, revenue, rate: views > 0 ? (conversions / views) * 100 : 0 };
  }, [offers]);

  if (metricsQuery.isLoading) {
    return <section className="h-40 animate-pulse rounded-xl border border-border bg-card" />;
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="border-b border-border px-5 py-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              <p className="text-[10px] uppercase tracking-[0.2em]">Vendas cruzadas</p>
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight">Desempenho dos upsells</h3>
          </div>
          <div className="grid max-w-full grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-background/45">
            <SummaryMetric label="Vistas" value={totals.views} />
            <SummaryMetric label="Aceites" value={totals.conversions} />
            <SummaryMetric label="Taxa" value={`${totals.rate.toFixed(0)}%`} />
          </div>
        </div>
      </header>

      {offers.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-surface text-muted-foreground">
            <Target className="h-5 w-5" />
          </div>
          <h4 className="mt-4 text-base font-medium">Ainda sem upsells configurados</h4>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Crie sugestões nos serviços para acompanhar vistas, aceites e receita adicional.
          </p>
        </div>
      ) : (
        <div className="p-4">
          <div className="premium-scrollbar max-h-[20rem] space-y-2 overflow-y-auto pr-1">
              {offers.map((offer) => {
                const views = offer.views_count ?? 0;
                const conversions = offer.conversions_count ?? 0;
                const revenue = Number(offer.extra_revenue ?? 0);
                const rate = views > 0 ? (conversions / views) * 100 : 0;

                return (
                  <article
                    key={offer.id}
                    className="grid gap-3 rounded-2xl border border-border bg-background/55 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-center"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Serviço principal
                      </p>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                        <ServiceCell value={serviceNames[offer.trigger_service_id] ?? "Serviço"} />
                        <span className="text-muted-foreground">→</span>
                        <ServiceCell value={serviceNames[offer.offered_service_id] ?? "Serviço sugerido"} strong />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <MetricBox label="Vistas" value={views} />
                      <MetricBox label="Aceites" value={conversions} />
                      <MetricBox label="Receita" value={`${revenue.toFixed(0)}€`} />
                      <MetricBox label="Taxa" value={`${rate.toFixed(0)}%`} highlight={rate > 0} />
                    </div>
                  </article>
                );
              })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface/70 px-4 py-3 text-sm text-muted-foreground">
              <span>Receita adicional total</span>
              <span className="font-semibold text-foreground"><VisualMoney value={`${totals.revenue.toFixed(2)}€`} /></span>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <p className="text-sm font-semibold leading-tight text-foreground">{value}</p>
      <p className="mt-0.5 text-[8px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function ServiceCell({ value, strong }: { value: string; strong?: boolean }) {
  return (
    <p className={cn("min-w-0 truncate text-sm", strong ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
      {value}
    </p>
  );
}

function MetricBox({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card/70 px-3 py-2 text-center">
      <p className={cn("truncate text-sm font-semibold tabular-nums text-foreground", highlight && "text-accent")}><VisualMoney value={String(value)} /></p>
      <p className="mt-0.5 truncate text-[8px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
