import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CreditCard,
  RefreshCw,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getPlatformMetrics, type PlatformMetrics } from "@/lib/platform-metrics.functions";
import { cn } from "@/lib/utils";
import { ExpandableList } from "@/components/ui/expandable-list";

export const Route = createFileRoute("/_authenticated/admin/central")({
  head: () => ({ meta: [{ title: "Central Bellza" }] }),
  component: CentralPage,
});

function fmt(cents: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

function CentralPage() {
  const fetchMetrics = useServerFn(getPlatformMetrics);
  const { data, isFetching, refetch, dataUpdatedAt } = useQuery<PlatformMetrics>({
    queryKey: ["platform-metrics"],
    queryFn: () => fetchMetrics(),
    staleTime: 60_000,
    retry: 1,
  });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
    : null;

  const hasAlerts =
    (data?.alerts.expiringSoon.length ?? 0) > 0 ||
    (data?.alerts.pastDue.length ?? 0) > 0 ||
    (data?.alerts.recentFailures.length ?? 0) > 0;
  const alertItems = [
    ...(data?.alerts.expiringSoon.map((a) => ({
      key: `expiring-${a.studioId}`,
      type: "warning" as const,
      text: `Assinatura a expirar em ${a.daysLeft} dia${a.daysLeft !== 1 ? "s" : ""}`,
      detail: a.name,
    })) ?? []),
    ...(data?.alerts.pastDue.map((a) => ({
      key: `past-${a.studioId}`,
      type: "danger" as const,
      text: "Pagamento em atraso",
      detail: a.name,
    })) ?? []),
    ...(data?.alerts.recentFailures.map((a) => ({
      key: `failure-${a.createdAt}-${a.studioId}`,
      type: "danger" as const,
      text: `Falha de pagamento · ${timeAgo(a.createdAt)}`,
      detail: a.name,
    })) ?? []),
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[82rem] space-y-6 px-4 py-6 md:px-8 md:py-8">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground/60">
              Bellza · Executivo
            </p>
            <h1 className="mt-0.5 text-2xl font-light tracking-tight">Central de Métricas</h1>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="hidden text-xs text-muted-foreground/60 sm:block">
                Actualizado às {lastUpdated}
              </span>
            )}
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-medium text-muted-foreground shadow-sm transition hover:border-foreground/20 hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              Actualizar
            </button>
          </div>
        </div>

        {/* ── Hero KPIs ─────────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <HeroKPI
            label="Receita Recorrente Mensal"
            sublabel="MRR"
            value={data ? fmt(data.revenue.mrrCents) : "—"}
            icon={TrendingUp}
            accent="emerald"
            loading={!data}
          />
          <HeroKPI
            label="Receita Recorrente Anual"
            sublabel="ARR estimado"
            value={data ? fmt(data.revenue.arrCents) : "—"}
            icon={ArrowUpRight}
            accent="blue"
            loading={!data}
          />
          <HeroKPI
            label="Total de Estúdios"
            sublabel="Plataforma"
            value={data ? String(data.studios.total) : "—"}
            icon={Building2}
            accent="violet"
            loading={!data}
          />
          <HeroKPI
            label="Taxa de Conversão"
            sublabel="Teste → Premium"
            value={data ? `${data.studios.conversionRate}%` : "—"}
            icon={Zap}
            accent="amber"
            loading={!data}
          />
        </div>

        {/* ── Studio Breakdown ──────────────────────────────────────────────── */}
        <Section title="Estúdios" icon={Building2}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <MetricTile label="Em Teste" value={data?.studios.trial} color="amber" />
            <MetricTile label="Premium Mensal" value={data?.studios.monthly} color="emerald" />
            <MetricTile label="Premium Anual" value={data?.studios.yearly} color="emerald" />
            <MetricTile label="Cancel. Agendado" value={data?.studios.scheduledCancel} color="amber" />
            <MetricTile label="Cancelados" value={data?.studios.cancelled} color="muted" />
            <MetricTile label="Novos 7 dias" value={data?.studios.new7d} color="blue" badge="+7d" />
            <MetricTile label="Novos 30 dias" value={data?.studios.new30d} color="blue" badge="+30d" />
          </div>
        </Section>

        {/* ── Financial Breakdown ───────────────────────────────────────────── */}
        <Section title="Plataforma" icon={CreditCard}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricTile
              label="Volume Total de Sinais"
              value={data ? fmt(data.payments.totalCents) : undefined}
              isAmount
              color="emerald"
            />
            <MetricTile
              label="Sinais Este Mês"
              value={data ? fmt(data.payments.monthCents) : undefined}
              isAmount
              color="blue"
            />
            <MetricTile
              label="Reservas Concluídas"
              value={data?.payments.completedCount}
              color="emerald"
            />
            <MetricTile
              label="Reservas Canceladas"
              value={data?.payments.cancelledCount}
              color="muted"
            />
            <MetricTile
              label="Pedidos de Reembolso"
              value={data?.payments.refundsCount}
              color={data && data.payments.refundsCount > 0 ? "red" : "muted"}
            />
          </div>
        </Section>

        {/* ── Charts ────────────────────────────────────────────────────────── */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Crescimento de Estúdios" sublabel="Novos por mês · últimos 6 meses">
            {data ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.studios.growthByMonth} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={24}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                      boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                    }}
                    formatter={(v: number) => [`${v} estúdios`, "Novos"]}
                    cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  />
                  <Bar dataKey="count" fill="var(--foreground)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartSkeleton />
            )}
          </ChartCard>

          <ChartCard title="Volume de Sinais" sublabel="Sinais recebidos por mês · últimos 6 meses">
            {data ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.payments.volumeByMonth}>
                  <defs>
                    <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    tickFormatter={(v) => `${(v / 100).toFixed(0)}€`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                      boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                    }}
                    formatter={(v: number) => [fmt(v), "Volume"]}
                    cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cents"
                    stroke="var(--foreground)"
                    strokeWidth={2}
                    fill="url(#volGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartSkeleton />
            )}
          </ChartCard>
        </div>

        {/* ── Alerts ────────────────────────────────────────────────────────── */}
        {(hasAlerts || !data) && (
          <Section title="Alertas" icon={AlertTriangle} iconColor="amber">
            <div className="space-y-2">
              {!data && (
                <>
                  <div className="h-14 animate-pulse rounded-2xl bg-muted/40" />
                  <div className="h-14 animate-pulse rounded-2xl bg-muted/40" />
                </>
              )}
              {data?.alerts.expiringSoon.map((a) => (
                <AlertRow
                  key={a.studioId}
                  type="warning"
                  text={`Assinatura a expirar em ${a.daysLeft} dia${a.daysLeft !== 1 ? "s" : ""}`}
                  detail={a.name}
                />
              ))}
              {data?.alerts.pastDue.map((a) => (
                <AlertRow
                  key={a.studioId}
                  type="danger"
                  text="Pagamento em atraso"
                  detail={a.name}
                />
              ))}
              {data?.alerts.recentFailures.map((a) => (
                <AlertRow
                  key={a.createdAt + a.studioId}
                  type="danger"
                  text={`Falha de pagamento · ${timeAgo(a.createdAt)}`}
                  detail={a.name}
                />
              ))}
              {data && !hasAlerts && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nenhum alerta activo — tudo a funcionar bem.
                </p>
              )}
            </div>
          </Section>
        )}

        {/* ── Activity Feed ─────────────────────────────────────────────────── */}
        <Section title="Actividade Recente" icon={BadgeCheck}>
          {!data ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-2xl bg-muted/40" />
              ))}
            </div>
          ) : data.activity.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sem actividade recente registada.
            </p>
          ) : (
            <ExpandableList
              items={data.activity}
              initialCount={5}
              className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border bg-card"
              getKey={(ev) => ev.id}
              moreLabel={(hidden) => `Ver mais ${hidden} evento${hidden !== 1 ? "s" : ""}`}
              renderItem={(ev, i) => (
                <div
                  className={cn(
                    "flex items-center gap-3 px-5 py-3.5",
                    i === 0 && "bg-muted/20",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-xl text-xs",
                      ev.kind === "payment_confirmed" &&
                        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      ev.kind === "payment_failed" && "bg-red-500/10 text-red-600 dark:text-red-400",
                      ev.kind === "refund_request" &&
                        "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      ev.kind === "withdrawal_requested" &&
                        "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                      ![
                        "payment_confirmed",
                        "payment_failed",
                        "refund_request",
                        "withdrawal_requested",
                      ].includes(ev.kind) && "bg-muted/60 text-muted-foreground",
                    )}
                  >
                    {ev.kind === "payment_confirmed" ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : ev.kind === "payment_failed" || ev.kind === "refund_request" ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm">{ev.text}</p>
                  <span className="shrink-0 text-xs text-muted-foreground/60">
                    {timeAgo(ev.time)}
                  </span>
                </div>
              )}
            />
          )}
        </Section>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const ACCENT_CLASSES: Record<
  string,
  { bg: string; text: string; iconBg: string }
> = {
  emerald: {
    bg: "from-emerald-500/8",
    text: "text-emerald-700 dark:text-emerald-400",
    iconBg: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  blue: {
    bg: "from-blue-500/8",
    text: "text-blue-700 dark:text-blue-400",
    iconBg: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  violet: {
    bg: "from-violet-500/8",
    text: "text-violet-700 dark:text-violet-400",
    iconBg: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  amber: {
    bg: "from-amber-500/8",
    text: "text-amber-700 dark:text-amber-400",
    iconBg: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
};

function HeroKPI({
  label,
  sublabel,
  value,
  icon: Icon,
  accent,
  loading,
}: {
  label: string;
  sublabel: string;
  value: string;
  icon: typeof TrendingUp;
  accent: string;
  loading: boolean;
}) {
  const c = ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.emerald;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border bg-card px-5 py-5 shadow-sm",
        `bg-gradient-to-br ${c.bg} via-transparent to-transparent`,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
            {sublabel}
          </p>
          {loading ? (
            <div className="mt-2 h-8 w-32 animate-pulse rounded-lg bg-muted/50" />
          ) : (
            <p className={cn("mt-1 text-[2rem] font-light leading-none tracking-tight", c.text)}>
              {value}
            </p>
          )}
          <p className="mt-2 text-xs font-medium text-muted-foreground">{label}</p>
        </div>
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-2xl", c.iconBg)}>
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
    </div>
  );
}

const TILE_COLORS: Record<string, string> = {
  emerald: "text-emerald-700 dark:text-emerald-400",
  blue: "text-blue-700 dark:text-blue-400",
  amber: "text-amber-700 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};

function MetricTile({
  label,
  value,
  color,
  badge,
  isAmount,
}: {
  label: string;
  value?: string | number;
  color: string;
  badge?: string;
  isAmount?: boolean;
}) {
  const colorClass = TILE_COLORS[color] ?? "text-muted-foreground";
  return (
    <div className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {label}
        </p>
        {badge && (
          <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      {value === undefined ? (
        <div className="h-7 w-16 animate-pulse rounded-lg bg-muted/50" />
      ) : (
        <p
          className={cn(
            "tracking-tight",
            isAmount ? "text-xl font-light" : "text-3xl font-light",
            colorClass,
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  iconColor,
  children,
}: {
  title: string;
  icon: typeof Building2;
  iconColor?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-7 place-items-center rounded-xl",
            iconColor === "amber"
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "bg-muted/60 text-muted-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ChartCard({
  title,
  sublabel,
  children,
}: {
  title: string;
  sublabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-sm">
      <p className="text-sm font-semibold tracking-tight">{title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sublabel}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-[200px] items-end gap-3">
      {[40, 60, 35, 80, 55, 70].map((h, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t-lg bg-muted/40"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function AlertRow({
  type,
  text,
  detail,
}: {
  type: "warning" | "danger";
  text: string;
  detail: string;
}) {
  const isWarning = type === "warning";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-4 py-3.5",
        isWarning
          ? "border-amber-200/60 bg-amber-50/60 dark:border-amber-800/30 dark:bg-amber-900/10"
          : "border-red-200/60 bg-red-50/60 dark:border-red-800/30 dark:bg-red-900/10",
      )}
    >
      <AlertTriangle
        className={cn(
          "h-4 w-4 shrink-0",
          isWarning
            ? "text-amber-500 dark:text-amber-400"
            : "text-red-500 dark:text-red-400",
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            isWarning
              ? "text-amber-800 dark:text-amber-300"
              : "text-red-800 dark:text-red-300",
          )}
        >
          {text}
        </p>
        <p
          className={cn(
            "text-xs",
            isWarning
              ? "text-amber-700/70 dark:text-amber-400/60"
              : "text-red-700/70 dark:text-red-400/60",
          )}
        >
          {detail}
        </p>
      </div>
    </div>
  );
}
