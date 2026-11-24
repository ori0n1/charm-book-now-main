import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
          <Metric label="Atendimentos" value={String(summary.completed)} />
          <Metric label="Ganhos do profissional" value={formatEUR(summary.commissionCents / 100)} featured />
          <Metric label="Parte do estúdio" value={formatEUR(summary.studioCents / 100)} />
        </div>
        <div className="mt-2 grid min-w-0 gap-2">
          <div className="min-w-0 rounded-xl border border-border/65 bg-background/60 p-2.5 sm:p-3">
            <h3 className="px-1 text-xs font-semibold">Evolução dos atendimentos</h3>
            <PerformanceChart points={summary.evolution} />
          </div>
          <div className="min-w-0 rounded-xl border border-border/65 bg-background/60 p-2.5 sm:p-3">
            <h3 className="px-1 text-xs font-semibold">Serviços mais realizados</h3>
            {summary.topServices.length === 0 ? <p className="px-1 pt-3 text-xs text-muted-foreground">Sem serviços no período.</p>
              : <ol className="mt-2 space-y-2">
                {summary.topServices.map((service) => <li key={service.serviceId} className="min-w-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 text-xs">
                    <span className="min-w-0 break-words">{service.name}</span>
                    <span className="whitespace-nowrap font-semibold tabular-nums">{service.count} · {service.percent.toLocaleString("pt-PT")} %</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${service.percent}%` }} /></div>
                </li>)}
              </ol>}
          </div>
        </div>
      </div>}
  </section>;
}

function Metric({ label, value, featured = false }: { label: string; value: string; featured?: boolean }) {
  return <div className={`min-w-max flex-1 rounded-xl border px-2 py-1.5 sm:px-3 sm:py-2 ${featured ? "border-emerald-600/30 bg-emerald-500/10" : "border-border/60 bg-background/70"}`}>
    <p className="whitespace-nowrap text-[8px] font-semibold leading-tight text-muted-foreground sm:text-[10px]">{label}</p>
    <p className="mt-1 whitespace-nowrap text-sm font-semibold leading-tight tabular-nums sm:text-lg">{value}</p>
  </div>;
}

function PerformanceChart({ points }: { points: { date: string; completed: number; commissionCents: number; services: { serviceId: string; name: string; count: number }[] }[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (!points.length) return null;
  const selected = active === null ? null : Math.min(active, points.length - 1);
  const maximum = Math.max(2, ...points.map((point) => point.completed));
  const x = (index: number) => 34 + index * 312 / Math.max(1, points.length - 1);
  const y = (count: number) => 100 - count * 75 / maximum;
  const line = points.map((point, index) => `${x(index)},${y(point.completed)}`).join(" ");
  const label = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  const selectedDay = selected === null ? null : points[selected];
  const selectAt = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - bounds.left) / bounds.width * 360;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round((position - 34) / 312 * (points.length - 1)))));
  };
  return <div className="relative mx-auto mt-1.5 w-full max-w-[720px]">
    <svg viewBox="0 0 360 125" className="h-auto w-full touch-pan-y" role="img" tabIndex={0}
      aria-label={`Evolução diária: ${points.map((point) => `${label(point.date)}: ${point.completed}`).join(", ")}`}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); selectAt(event); }}
      onPointerMove={selectAt}
      onPointerUp={(event) => { if (event.pointerType !== "mouse") setActive(null); }}
      onPointerLeave={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) setActive(null); }}
      onPointerCancel={() => setActive(null)}
      onFocus={() => setActive((current) => current ?? points.length - 1)}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setActive(Math.max(0, Math.min(points.length - 1, (selected ?? points.length - 1) + (event.key === "ArrowRight" ? 1 : -1))));
        }
      }}>
      {[0, 1, 2].map((step) => <g key={step}><line x1="34" x2="346" y1={y(maximum * step / 2)} y2={y(maximum * step / 2)} stroke="currentColor" opacity=".12" />
        <text x="28" y={y(maximum * step / 2) + 3} textAnchor="end" fill="currentColor" opacity=".55" fontSize="9">{Math.round(maximum * step / 2)}</text></g>)}
      <polygon points={`34,100 ${line} 346,100`} fill="#10b981" opacity=".1" />
      <polyline points={line} fill="none" stroke="#059669" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {selected !== null && <>
        <line x1={x(selected)} x2={x(selected)} y1="20" y2="100" stroke="#059669" strokeWidth="1" strokeDasharray="3 3" opacity=".3" />
        <circle cx={x(selected)} cy={y(points[selected].completed)} r="4" fill="#059669" stroke="white" strokeWidth="2" />
      </>}
      {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index) =>
        <text key={index} x={x(index)} y="119" textAnchor="middle" fill="currentColor" opacity=".6" fontSize="9">{label(points[index].date)}</text>)}
    </svg>
    {selectedDay && selected !== null && <div
      className="pointer-events-none absolute top-1 z-10 w-36 rounded-xl border border-emerald-700/20 bg-card/95 p-2 text-[10px] leading-snug shadow-lg backdrop-blur-sm sm:w-44"
      role="status" aria-label="Detalhe do dia selecionado"
      style={{ left: `${x(selected) / 360 * 100}%`, transform: x(selected) <= 180 ? "translateX(8px)" : "translateX(calc(-100% - 8px))" }}>
      <p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{selectedDay.date.slice(8, 10)}/{selectedDay.date.slice(5, 7)}/{selectedDay.date.slice(0, 4)}</p>
      <p className="mt-1 font-semibold tabular-nums">{formatEUR(selectedDay.commissionCents / 100)} ganhos</p>
      <div className="mt-1 border-t border-border/70 pt-1">
        {selectedDay.services.length ? selectedDay.services.map((service) =>
          <p key={service.serviceId} className="break-words">{service.name} · {service.count}</p>)
          : <p>Sem serviços nesse dia</p>}
      </div>
    </div>}
  </div>;
}
