import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { summarizeDailyMovement, type DailyMovementChartDay } from "@/lib/daily-movement";
import { VisualMoney, useVisualMoneyHidden } from "@/components/visual-money-privacy";

export function DailyMovementChart({
  data,
  periodControls,
}: {
  data: DailyMovementChartDay[];
  periodControls?: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const hidden = useVisualMoneyHidden();
  const viewportWidth = useElementWidth(viewportRef);
  const summary = useMemo(() => summarizeDailyMovement(data), [data]);
  const hasMovement = data.some(
    (day) => day.appointments > 0 || day.total > 0 || day.received > 0 || day.pending > 0,
  );
  const labelCapacity = viewportWidth > 0 ? Math.max(3, Math.floor(viewportWidth / 58)) : 5;
  const labelInterval = Math.max(0, Math.ceil(data.length / labelCapacity) - 1);
  const maxFinancialValue = Math.max(
    1,
    ...data.map((day) => Math.max(day.total, day.received + day.pending)),
  );

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card shadow-sm">
      <div className="space-y-3 border-b border-border/60 px-3.5 py-3.5 sm:px-4 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Receita por dia
            </p>
            <p className="mt-1 text-sm leading-snug text-foreground">
              Acompanhe quanto foi agendado, recebido e ainda está por receber.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground sm:justify-end">
            <ChartKey color="bg-emerald-500" label="Recebido" />
            <ChartKey color="bg-amber-400" label="Por receber" />
            <ChartKey color="bg-sky-400" label="Agendado" line />
          </div>
        </div>
        {periodControls}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          <SummaryValue label="Agendado" value={formatEUR(summary.scheduled)} />
          <SummaryValue label="Recebido" value={formatEUR(summary.received)} emphasis />
          <SummaryValue label="Por receber" value={formatEUR(summary.pending)} />
        </div>
      </div>

      {!hasMovement ? (
        <div className="flex min-h-52 items-center justify-center px-5 py-10 text-center sm:min-h-60">
          <div>
            <p className="text-sm font-semibold text-foreground">Sem movimentação neste período.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              As receitas aparecerão aqui quando houver marcações.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="px-3.5 pt-3 text-[10px] text-muted-foreground sm:px-4">
            Passe ou toque num dia para ver os detalhes.
          </p>
          <div ref={viewportRef} className="h-64 w-full min-w-0 px-1 pb-2 pt-2 sm:h-72 sm:px-2">
            {hidden ? <div className="flex h-full items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground">Valores ocultos · •••• €</div> :
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 10, right: 6, bottom: 2, left: 0 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="currentColor"
                  className="text-border"
                  strokeOpacity={0.45}
                  strokeDasharray="3 6"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  interval={labelInterval}
                  minTickGap={18}
                  height={28}
                  tick={{ fill: "currentColor", fontSize: 10 }}
                  className="text-muted-foreground"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={50}
                  tickCount={3}
                  domain={[0, maxFinancialValue]}
                  tickFormatter={(value: number) => `${Math.round(value)} €`}
                  tick={{ fill: "currentColor", fontSize: 10 }}
                  className="text-muted-foreground"
                />
                <Tooltip
                  content={<DailyMovementTooltip />}
                  cursor={{ fill: "rgba(148, 163, 184, 0.07)" }}
                  isAnimationActive={false}
                  wrapperStyle={{ maxWidth: "calc(100% - 12px)", zIndex: 20 }}
                />
                <Bar
                  dataKey="received"
                  name="Recebido"
                  stackId="finance"
                  fill="#10b981"
                  fillOpacity={0.88}
                  maxBarSize={22}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="pending"
                  name="Por receber"
                  stackId="finance"
                  fill="#fbbf24"
                  fillOpacity={0.72}
                  radius={[5, 5, 0, 0]}
                  maxBarSize={22}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Agendado"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#38bdf8", stroke: "#082f49", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            }
          </div>
        </div>
      )}
    </section>
  );
}

function DailyMovementTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DailyMovementChartDay }>;
}) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;

  return (
    <div className="w-52 max-w-full rounded-xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur-sm">
      <p className="border-b border-border/70 pb-2 text-xs font-semibold">{day.fullDate}</p>
      <p className="mt-2 text-xs font-medium text-foreground">
        {day.appointments} {day.appointments === 1 ? "marcação" : "marcações"}
      </p>
      <dl className="mt-2 space-y-1.5 text-xs">
        <TooltipValue color="bg-sky-400" label="Agendado" value={formatEUR(day.total)} />
        <TooltipValue color="bg-emerald-500" label="Recebido" value={formatEUR(day.received)} />
        <TooltipValue color="bg-amber-400" label="Por receber" value={formatEUR(day.pending)} />
      </dl>
    </div>
  );
}

function SummaryValue({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-background/45 px-2.5 py-2 sm:px-3">
      <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground sm:text-[10px]">
        {label}
      </p>
      <p
        className={`mt-1 whitespace-nowrap text-[clamp(0.7rem,3.4vw,1rem)] font-semibold leading-tight tracking-tight tabular-nums ${
          emphasis ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
        }`}
      >
        <VisualMoney value={value} />
      </p>
    </div>
  );
}

function ChartKey({
  color,
  label,
  line = false,
}: {
  color: string;
  label: string;
  line?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`${line ? "h-0.5 w-3 rounded-full" : "size-2 rounded-sm"} ${color}`} />
      {label}
    </span>
  );
}

function TooltipValue({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <span className={`size-2 shrink-0 rounded-full ${color}`} />
        {label}
      </dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const updateWidth = () => setWidth(Math.round(element.getBoundingClientRect().width));
    updateWidth();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function formatEUR(value: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}
