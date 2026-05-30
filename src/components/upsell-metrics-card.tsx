import { type ReactNode, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, Target, TrendingUp, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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

  const offers = metricsQuery.data?.offers ?? [];
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
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              <p className="text-[10px] uppercase tracking-[0.2em]">Vendas cruzadas</p>
            </div>
            <h3 className="mt-1 text-xl font-light tracking-tight">Desempenho dos upsells</h3>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
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
            Crie sugestões dentro de cada serviço para acompanhar visualizações, aceites e receita adicional.
          </p>
        </div>
      ) : (
        <div className="space-y-3 p-3 sm:p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {offers.map((offer) => {
              const views = offer.views_count ?? 0;
              const conversions = offer.conversions_count ?? 0;
              const revenue = Number(offer.extra_revenue ?? 0);
              const rate = views > 0 ? (conversions / views) * 100 : 0;

              return (
                <article key={offer.id} className="rounded-lg border border-border bg-background p-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <ServicePill label="Serviço principal" value={serviceNames[offer.trigger_service_id] ?? "Serviço"} />
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <ServicePill label="Upsell sugerido" value={serviceNames[offer.offered_service_id] ?? "Serviço sugerido"} strong />
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Kpi icon={<Eye className="h-3.5 w-3.5" />} label="Visualizações" value={views} />
                      <Kpi icon={<Target className="h-3.5 w-3.5" />} label="Conversões" value={conversions} />
                      <Kpi icon={<Wallet className="h-3.5 w-3.5" />} label="Receita" value={`${revenue.toFixed(0)}€`} />
                      <Kpi label="Taxa" value={`${rate.toFixed(0)}%`} highlight={rate > 0} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="rounded-lg bg-surface px-4 py-3 text-sm text-muted-foreground">
            Receita adicional total: <span className="font-medium text-foreground">{totals.revenue.toFixed(2)}€</span>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-center">
      <p className="text-lg font-light leading-tight text-foreground">{value}</p>
      <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function ServicePill({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-sm", strong ? "font-semibold" : "font-medium")}>{value}</p>
    </div>
  );
}

function Kpi({ icon, label, value, highlight }: { icon?: ReactNode; label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <p className="text-[9px] uppercase tracking-wide">{label}</p>
      </div>
      <p className={cn("mt-1 text-base font-light", highlight && "text-accent")}>{value}</p>
    </div>
  );
}