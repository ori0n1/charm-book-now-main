import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Euro, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getProfessionalDailySummaries } from "@/lib/professional-daily-summary.functions";
import { formatEUR } from "@/lib/utils";

type Period = "today" | "7d" | "15d" | "custom";
const filters: { value: Period; label: string }[] = [
  { value: "today", label: "Hoje" }, { value: "7d", label: "7 dias" },
  { value: "15d", label: "15 dias" }, { value: "custom", label: "Personalizado" },
];

export function ProfessionalPerformance({ studioId, staffId, viewerRole, title = "Meu desempenho" }: {
  studioId: string; staffId: string; viewerRole: string; title?: string;
}) {
  const load = useServerFn(getProfessionalDailySummaries);
  const [period, setPeriod] = useState<Period>("7d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const validCustom = period !== "custom" || Boolean(startDate && endDate && startDate <= endDate);
  const days = period === "today" ? 1 : period === "15d" ? 15 : 7;
  const summaries = useQuery({
    queryKey: ["professional-performance", studioId, staffId, viewerRole, period, period === "custom" ? startDate : "", period === "custom" ? endDate : ""],
    enabled: Boolean(studioId && staffId && validCustom),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: () => load({ data: {
      studioId, days,
      ...(period === "custom" ? { startDate, endDate } : {}),
    } }),
  });
  const refetch = summaries.refetch;
  useEffect(() => {
    if (!studioId || !staffId) return;
    const channel = supabase.channel(`professional-performance-${studioId}-${staffId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `studio_id=eq.${studioId}` }, () => void refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "appointment_services" }, () => void refetch())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [studioId, staffId, refetch]);

  const summary = summaries.data?.[staffId];
  return <section className="min-w-0 overflow-hidden rounded-[1.25rem] border border-border/70 bg-card shadow-sm">
    <div className="border-b border-border/60 bg-[radial-gradient(circle_at_85%_0%,rgba(16,185,129,.18),transparent_52%)] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h2>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Fuso do estúdio</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-muted/75 p-1" role="group" aria-label="Período do desempenho">
        {filters.map((filter) => <button key={filter.value} type="button" onClick={() => setPeriod(filter.value)}
          aria-pressed={period === filter.value}
          className={`min-h-9 rounded-lg px-1 text-[11px] font-semibold leading-tight transition sm:text-xs ${period === filter.value ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}>
          {filter.label}
        </button>)}
      </div>
      {period === "custom" && <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="min-w-0 text-[11px] font-medium text-muted-foreground">Início
          <input type="date" aria-label="Data inicial" value={startDate} max={endDate || undefined}
            onChange={(event) => setStartDate(event.target.value)}
            className="mt-1 h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
        </label>
        <label className="min-w-0 text-[11px] font-medium text-muted-foreground">Fim
          <input type="date" aria-label="Data final" value={endDate} min={startDate || undefined}
            onChange={(event) => setEndDate(event.target.value)}
            className="mt-1 h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
        </label>
      </div>}
    </div>
    {!validCustom ? <p className="p-4 text-sm text-muted-foreground">Selecione as duas datas por ordem.</p>
      : summaries.isError ? <p className="p-4 text-sm text-red-600">Não foi possível carregar o desempenho.</p>
      : !summary ? <p className="p-4 text-sm text-muted-foreground">A carregar...</p>
      : <div className="min-w-0 p-3 sm:p-4">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 sm:gap-2" aria-label="Resumo do período">
          <Metric icon={<CalendarDays className="size-4" />} label="Atendimentos" value={String(summary.completed)} />
          <Metric icon={<Euro className="size-4" />} label="Ganhos" value={formatEUR(summary.commissionCents / 100)} featured />
          <Metric icon={<Users className="size-4" />} label="Estúdio" value={formatEUR(summary.studioCents / 100)} />
        </div>
        <div className="mt-2 flex min-w-0 gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:overflow-visible">
          <div className="w-[min(82vw,440px)] min-w-[280px] shrink-0 rounded-xl border border-border/65 bg-background/60 p-2.5 lg:w-auto lg:min-w-0">
            <h3 className="px-1 text-xs font-semibold">Evolução dos atendimentos</h3>
            <PerformanceChart points={summary.evolution} />
          </div>
          <div className="w-[min(76vw,360px)] min-w-[250px] shrink-0 overflow-x-auto rounded-xl border border-border/65 bg-background/60 p-2.5 lg:w-auto lg:min-w-0">
            <h3 className="whitespace-nowrap px-1 text-xs font-semibold">Serviços mais realizados</h3>
            {summary.topServices.length === 0 ? <p className="px-1 pt-3 text-xs text-muted-foreground">Sem serviços no período.</p>
              : <ol className="mt-2 space-y-2">
                {summary.topServices.map((service) => <li key={service.serviceId} className="min-w-max">
                  <div className="flex min-w-max items-center justify-between gap-2 whitespace-nowrap text-xs">
                    <span>{service.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{service.count} · {service.percent.toLocaleString("pt-PT")} %</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${service.percent}%` }} /></div>
                </li>)}
              </ol>}
          </div>
        </div>
      </div>}
  </section>;
}

function Metric({ icon, label, value, featured = false }: { icon: React.ReactNode; label: string; value: string; featured?: boolean }) {
  return <div className={`min-w-max flex-1 rounded-xl border p-2 sm:p-3 ${featured ? "border-emerald-600/30 bg-emerald-500/10" : "border-border/60 bg-background/70"}`}>
    <div className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">{icon}<span className="text-[9px] font-semibold uppercase leading-tight">{label}</span></div>
    <p className="mt-1.5 whitespace-nowrap text-[clamp(.78rem,2.7vw,1.25rem)] font-semibold leading-tight tabular-nums">{value}</p>
  </div>;
}

function PerformanceChart({ points }: { points: { date: string; completed: number; commissionCents: number; topService: { serviceId: string; name: string; count: number } | null }[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (!points.length) return null;
  const selected = Math.min(active ?? points.length - 1, points.length - 1);
  const maximum = Math.max(2, ...points.map((point) => point.completed));
  const x = (index: number) => 34 + index * 312 / Math.max(1, points.length - 1);
  const y = (count: number) => 100 - count * 75 / maximum;
  const line = points.map((point, index) => `${x(index)},${y(point.completed)}`).join(" ");
  const label = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  const selectedDay = points[selected];
  const selectAt = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - bounds.left) / bounds.width * 360;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round((position - 34) / 312 * (points.length - 1)))));
  };
  return <div className="mt-1.5 min-w-0">
    <div className="flex min-w-0 gap-1 overflow-x-auto whitespace-nowrap px-1 pb-1 text-[11px]" aria-live="polite" aria-label="Detalhe do dia selecionado">
      <strong className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-1 text-emerald-700 dark:text-emerald-400">{selectedDay.date.slice(8, 10)}/{selectedDay.date.slice(5, 7)}/{selectedDay.date.slice(0, 4)} · {selectedDay.completed}</strong>
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-1">{formatEUR(selectedDay.commissionCents / 100)} ganhos</span>
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-1">{selectedDay.topService ? `${selectedDay.topService.name} · ${selectedDay.topService.count}` : "Sem serviços"}</span>
    </div>
    <svg viewBox="0 0 360 125" className="h-auto w-full touch-pan-y" role="img" tabIndex={0}
      aria-label={`Evolução diária: ${points.map((point) => `${label(point.date)}: ${point.completed}`).join(", ")}`}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); selectAt(event); }}
      onPointerMove={selectAt}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setActive(Math.max(0, Math.min(points.length - 1, selected + (event.key === "ArrowRight" ? 1 : -1))));
        }
      }}>
      {[0, 1, 2].map((step) => <g key={step}><line x1="34" x2="346" y1={y(maximum * step / 2)} y2={y(maximum * step / 2)} stroke="currentColor" opacity=".12" />
        <text x="28" y={y(maximum * step / 2) + 3} textAnchor="end" fill="currentColor" opacity=".55" fontSize="9">{Math.round(maximum * step / 2)}</text></g>)}
      <polygon points={`34,100 ${line} 346,100`} fill="#10b981" opacity=".1" />
      <polyline points={line} fill="none" stroke="#059669" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={x(selected)} x2={x(selected)} y1="20" y2="100" stroke="#059669" strokeWidth="1" strokeDasharray="3 3" />
      <circle cx={x(selected)} cy={y(points[selected].completed)} r="4" fill="#059669" stroke="white" strokeWidth="2" />
      {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index) =>
        <text key={index} x={x(index)} y="119" textAnchor="middle" fill="currentColor" opacity=".6" fontSize="9">{label(points[index].date)}</text>)}
    </svg>
  </div>;
}
