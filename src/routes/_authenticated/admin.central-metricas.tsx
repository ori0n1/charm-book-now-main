import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Ban,
  Building2,
  CalendarCheck2,
  CircleOff,
  ChevronDown,
  Download,
  Euro,
  FileSpreadsheet,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  exportPlatformMetrics,
  getPlatformMetrics,
  type PlatformMetricsFilters,
  type PlatformMetricsResponse,
} from "@/lib/platform-metrics.functions";
import {
  CentralShell,
  chartTooltipStyle,
  EmptyState,
  formatDateTime,
  formatMoney,
  MetricCard,
  Panel,
  StatusBadge,
} from "@/components/central/central-ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/central-metricas")({
  validateSearch: (search: Record<string, unknown>) => ({
    studio:
      typeof search.studio === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        search.studio,
      )
        ? search.studio
        : undefined,
  }),
  head: () => ({ meta: [{ title: "Central de Métricas · Bellza" }] }),
  component: CentralMetricsPage,
});

const BASE_FILTERS: PlatformMetricsFilters = {
  studioId: null,
  preset: "30d",
  from: null,
  to: null,
  plan: "all",
  accountStatus: "all",
  subscriptionStatus: "all",
};

const PERIOD_OPTIONS = [
  ["today", "Hoje"],
  ["7d", "Últimos 7 dias"],
  ["30d", "Últimos 30 dias"],
  ["month", "Mês atual"],
  ["year", "Ano atual"],
  ["custom", "Período personalizado"],
] as const;

const VIEW_OPTIONS = [
  ["overview", "Visão geral"],
  ["appointments", "Marcações"],
  ["growth", "Crescimento"],
  ["comparison", "Comparações"],
] as const;

type MetricsView = (typeof VIEW_OPTIONS)[number][0];

function CentralMetricsPage() {
  const search = Route.useSearch();
  const fetchMetrics = useServerFn(getPlatformMetrics);
  const exportMetrics = useServerFn(exportPlatformMetrics);
  const [filters, setFilters] = useState<PlatformMetricsFilters>({
    ...BASE_FILTERS,
    studioId: search.studio || null,
  });
  const [activeView, setActiveView] = useState<MetricsView>("overview");
  const [studioOptions, setStudioOptions] = useState<PlatformMetricsResponse["studioOptions"]>([]);
  const [exporting, setExporting] = useState<"csv" | "excel" | null>(null);
  const query = useQuery<PlatformMetricsResponse>({
    queryKey: ["platform-metrics-v2", filters],
    queryFn: () => fetchMetrics({ data: filters }),
    staleTime: 60_000,
    retry: 1,
  });
  const metrics = query.data?.metrics;
  useEffect(() => {
    if (query.data?.studioOptions) setStudioOptions(query.data.studioOptions);
  }, [query.data?.studioOptions]);

  const hasTimelineValue = (key: keyof NonNullable<typeof metrics>["timeline"][number]) =>
    metrics?.timeline.some((point) => Number(point[key]) > 0) ?? false;

  const updateFilter = <K extends keyof PlatformMetricsFilters>(
    key: K,
    value: PlatformMetricsFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setActiveView("overview");
  };

  const downloadExport = async (format: "csv" | "excel") => {
    setExporting(format);
    try {
      const result = await exportMetrics({ data: { ...filters, format } });
      const blob = new Blob([result.content], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  };

  return (
    <CentralShell
      updatedAt={metrics?.generatedAt}
      actions={
        <button
          type="button"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-muted-foreground shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")} />
          <span className="hidden sm:inline">Atualizar</span>
        </button>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Análise administrativa
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                Central de Métricas
              </h1>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
                Receita Bellza e volume dos estúdios são apresentados separadamente, usando dados
                reais do período e do estúdio selecionado.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => downloadExport("csv")}
                disabled={!!exporting || !metrics}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {exporting === "csv" ? "A gerar…" : "CSV"}
              </button>
              <button
                type="button"
                onClick={() => downloadExport("excel")}
                disabled={!!exporting || !metrics}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold disabled:opacity-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {exporting === "excel" ? "A gerar…" : "Excel"}
              </button>
            </div>
          </div>
        </section>

        <Panel
          title="Filtros"
          description="Troque o estúdio ou o período para atualizar toda a análise."
        >
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1.5fr)_minmax(12rem,1fr)_auto]">
            <FilterSelect
              label="Estúdio"
              value={filters.studioId || "all"}
              onChange={(value) => {
                setFilters((current) => ({
                  ...current,
                  studioId: value === "all" ? null : value,
                  plan: "all",
                  accountStatus: "all",
                  subscriptionStatus: "all",
                }));
                setActiveView("overview");
              }}
            >
              <option value="all">Todos os estúdios</option>
              {studioOptions.map((studio) => (
                <option key={studio.id} value={studio.id}>
                  {studio.name}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Período"
              value={filters.preset}
              onChange={(value) =>
                updateFilter("preset", value as PlatformMetricsFilters["preset"])
              }
            >
              {PERIOD_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FilterSelect>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setFilters({ ...BASE_FILTERS, studioId: null });
                  setActiveView("overview");
                }}
                className="h-10 w-full whitespace-nowrap rounded-xl border border-border bg-background px-4 text-xs font-semibold text-muted-foreground"
              >
                Limpar filtros
              </button>
            </div>
          </div>
          {filters.preset === "custom" && (
            <div className="grid gap-3 border-t border-border/60 p-3 sm:grid-cols-2">
              <DateFilter
                label="Data inicial"
                value={filters.from || ""}
                onChange={(value) => updateFilter("from", value || null)}
              />
              <DateFilter
                label="Data final"
                value={filters.to || ""}
                onChange={(value) => updateFilter("to", value || null)}
              />
            </div>
          )}
          <details className="group border-t border-border/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-muted-foreground">
              Filtros avançados
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 border-t border-border/40 p-3 sm:grid-cols-3">
              <FilterSelect
                label="Plano"
                value={filters.plan}
                onChange={(value) => updateFilter("plan", value as PlatformMetricsFilters["plan"])}
              >
                <option value="all">Todos os planos</option>
                <option value="trial">Teste gratuito</option>
                <option value="monthly">Mensal</option>
                <option value="quarterly">Trimestral</option>
                <option value="yearly">Anual</option>
              </FilterSelect>
              <FilterSelect
                label="Estado da conta"
                value={filters.accountStatus}
                onChange={(value) =>
                  updateFilter("accountStatus", value as PlatformMetricsFilters["accountStatus"])
                }
              >
                <option value="all">Todos os estados</option>
                <option value="active">Ativa</option>
                <option value="blocked">Bloqueada</option>
                <option value="cancelled">Cancelada</option>
              </FilterSelect>
              <FilterSelect
                label="Assinatura"
                value={filters.subscriptionStatus}
                onChange={(value) =>
                  updateFilter(
                    "subscriptionStatus",
                    value as PlatformMetricsFilters["subscriptionStatus"],
                  )
                }
              >
                <option value="all">Todas as assinaturas</option>
                <option value="trialing">Em teste</option>
                <option value="active">Ativa</option>
                <option value="past_due">Vencida</option>
                <option value="canceled">Cancelada</option>
              </FilterSelect>
            </div>
          </details>
        </Panel>

        {query.isError && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
            Não foi possível atualizar os dados agora. A análise anterior foi removida para não
            misturar informações. Tente novamente ou escolha outro período.
          </div>
        )}

        {metrics?.selectedStudio && (
          <section className="overflow-hidden rounded-2xl border border-violet-500/20 bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border/60 bg-violet-500/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
                  Estúdio selecionado
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold tracking-tight">
                  {metrics.selectedStudio.name}
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  {metrics.selectedStudio.ownerName} · {metrics.selectedStudio.email}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={studioAccountLabel(metrics.selectedStudio)} />
                <StatusBadge value={metrics.selectedStudio.subscriptionStatus} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
              <Info label="Responsável" value={metrics.selectedStudio.ownerName} />
              <Info label="E-mail" value={metrics.selectedStudio.email} />
              <Info
                label="Criação da conta"
                value={formatDateTime(
                  metrics.selectedStudio.createdAt,
                  metrics.selectedStudio.timezone,
                )}
              />
              <Info
                label="Início do teste"
                value={formatDateTime(
                  metrics.selectedStudio.trialStartedAt,
                  metrics.selectedStudio.timezone,
                )}
              />
              <Info
                label="Fim do teste"
                value={formatDateTime(
                  metrics.selectedStudio.trialEndsAt,
                  metrics.selectedStudio.timezone,
                )}
              />
              <Info
                label="Dias gratuitos"
                value={`${metrics.selectedStudio.trialDaysRemaining} dias`}
              />
              <Info label="Plano" value={metrics.selectedStudio.plan} />
              <Info
                label="Último acesso"
                value={formatDateTime(
                  metrics.selectedStudio.lastAccessAt,
                  metrics.selectedStudio.timezone,
                )}
              />
              <Info label="Estado da conta" value={studioAccountLabel(metrics.selectedStudio)} />
              <Info label="Assinatura" value={metrics.selectedStudio.subscriptionStatus} />
            </div>
          </section>
        )}

        <section
          aria-label="Indicadores principais"
          className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6"
        >
          <MetricCard
            label="Receita Bellza"
            value={formatMoney(metrics?.finances.platformRevenueCents ?? 0)}
            hint="Assinaturas pagas"
            icon={Euro}
            accent="emerald"
            money
            loading={query.isLoading || query.isFetching}
          />
          <MetricCard
            label="Volume dos estúdios"
            value={formatMoney(metrics?.finances.studioVolumeCents ?? 0)}
            hint="Marcações concluídas"
            icon={Euro}
            accent="violet"
            money
            loading={query.isLoading || query.isFetching}
          />
          <MetricCard
            label="Marcações"
            value={metrics?.appointments.total ?? 0}
            hint={metrics?.period.label ?? "Período"}
            icon={CalendarCheck2}
            accent="blue"
            loading={query.isLoading || query.isFetching}
          />
          <MetricCard
            label="Concluídas"
            value={metrics?.appointments.completed ?? 0}
            hint="Atendimentos realizados"
            icon={CalendarCheck2}
            accent="emerald"
            loading={query.isLoading || query.isFetching}
          />
          <MetricCard
            label="Clientes"
            value={metrics?.clients.total ?? 0}
            hint="Total no escopo"
            icon={Users}
            accent="violet"
            loading={query.isLoading || query.isFetching}
          />
          <MetricCard
            label="Novos clientes"
            value={metrics?.clients.newInPeriod ?? 0}
            hint={metrics?.period.label ?? "Período"}
            icon={UserPlus}
            accent="blue"
            loading={query.isLoading || query.isFetching}
          />
        </section>

        <nav
          aria-label="Secções das métricas"
          className="flex gap-1 overflow-x-auto rounded-2xl border border-border/80 bg-card p-1.5 shadow-sm"
        >
          {VIEW_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={activeView === value}
              onClick={() => setActiveView(value)}
              className={cn(
                "min-h-10 flex-1 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition",
                activeView === value
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeView === "growth" && (
          <details className="group overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
              <span>
                <span className="block text-sm font-semibold">Indicadores de estúdios</span>
                <span className="text-[11px] text-muted-foreground">
                  Estados das contas e assinaturas
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <section className="grid grid-cols-2 gap-2.5 border-t border-border/60 p-3 md:grid-cols-4 xl:grid-cols-8">
              <MetricCard
                label="Estúdios"
                value={metrics?.studios.total ?? 0}
                hint="Escopo atual"
                icon={Building2}
                accent="violet"
                loading={query.isLoading}
              />
              <MetricCard
                label="Ativos"
                value={metrics?.studios.active ?? 0}
                hint="Contas operacionais"
                icon={CalendarCheck2}
                accent="emerald"
                loading={query.isLoading}
              />
              <MetricCard
                label="Bloqueados"
                value={metrics?.studios.blocked ?? 0}
                hint="Acesso desativado"
                icon={Ban}
                accent="red"
                loading={query.isLoading}
              />
              <MetricCard
                label="Cancelados"
                value={metrics?.studios.cancelled ?? 0}
                hint="Conta cancelada"
                icon={CircleOff}
                loading={query.isLoading}
              />
              <MetricCard
                label="Novos estúdios"
                value={metrics?.studios.newInPeriod ?? 0}
                hint={metrics?.period.label}
                icon={Building2}
                accent="blue"
                loading={query.isLoading}
              />
              <MetricCard
                label="Em teste"
                value={metrics?.studios.trial ?? 0}
                hint="Teste gratuito"
                icon={Activity}
                accent="amber"
                loading={query.isLoading}
              />
              <MetricCard
                label="Assinaturas ativas"
                value={metrics?.studios.paidActive ?? 0}
                hint="Planos pagos"
                icon={TrendingUp}
                accent="emerald"
                loading={query.isLoading}
              />
              <MetricCard
                label="Vencidas"
                value={metrics?.studios.expired ?? 0}
                hint="Requer atenção"
                icon={TrendingDown}
                accent="red"
                loading={query.isLoading}
              />
            </section>
          </details>
        )}

        {activeView === "appointments" && (
          <details className="group overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
              <span>
                <span className="block text-sm font-semibold">Indicadores detalhados</span>
                <span className="text-[11px] text-muted-foreground">
                  Estados, valor médio, clientes e taxas
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <section className="grid grid-cols-2 gap-2.5 border-t border-border/60 p-3 md:grid-cols-4 xl:grid-cols-6">
              <MetricCard
                label="Receita Bellza"
                value={formatMoney(metrics?.finances.platformRevenueCents ?? 0)}
                hint="Somente assinaturas pagas"
                icon={Euro}
                accent="emerald"
                money
                loading={query.isLoading}
              />
              <MetricCard
                label="Volume dos estúdios"
                value={formatMoney(metrics?.finances.studioVolumeCents ?? 0)}
                hint="Marcações concluídas"
                icon={Euro}
                accent="violet"
                money
                loading={query.isLoading}
              />
              <MetricCard
                label="Marcações"
                value={metrics?.appointments.total ?? 0}
                hint="Total no período"
                icon={CalendarCheck2}
                accent="blue"
                loading={query.isLoading}
              />
              <MetricCard
                label="Concluídas"
                value={metrics?.appointments.completed ?? 0}
                hint="Atendimentos realizados"
                icon={CalendarCheck2}
                accent="emerald"
                loading={query.isLoading}
              />
              <MetricCard
                label="Canceladas"
                value={metrics?.appointments.cancelled ?? 0}
                hint="Canceladas no período"
                icon={CircleOff}
                accent="red"
                loading={query.isLoading}
              />
              <MetricCard
                label="Pendentes"
                value={metrics?.appointments.pending ?? 0}
                hint="Pendentes ou confirmadas"
                icon={Activity}
                accent="amber"
                loading={query.isLoading}
              />
              <MetricCard
                label="Não compareceram"
                value={metrics?.appointments.noShow ?? 0}
                hint="Estado não compareceu"
                icon={CircleOff}
                accent="red"
                loading={query.isLoading}
              />
              <MetricCard
                label="Valor médio"
                value={formatMoney(metrics?.finances.averageAppointmentCents ?? 0)}
                hint="Por marcação concluída"
                icon={Euro}
                accent="amber"
                money
                loading={query.isLoading}
              />
              <MetricCard
                label="Clientes"
                value={metrics?.clients.total ?? 0}
                hint="Total no escopo"
                icon={Users}
                accent="violet"
                loading={query.isLoading}
              />
              <MetricCard
                label="Novos clientes"
                value={metrics?.clients.newInPeriod ?? 0}
                hint="Criados no período"
                icon={UserPlus}
                accent="blue"
                loading={query.isLoading}
              />
              <MetricCard
                label="Conversão"
                value={`${metrics?.rates.trialConversion ?? 0}%`}
                hint="Teste gratuito → pago"
                icon={UserPlus}
                accent="blue"
                loading={query.isLoading}
              />
              <MetricCard
                label="Cancelamento"
                value={`${metrics?.rates.subscriptionCancellation ?? 0}%`}
                hint="Taxa de assinaturas"
                icon={TrendingDown}
                accent="red"
                loading={query.isLoading}
              />
            </section>
          </details>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          {activeView === "growth" && (
            <MetricChart
              title="Crescimento de estúdios"
              description={`Novos cadastros · ${metrics?.period.label ?? "período"}`}
              hasData={hasTimelineValue("studios")}
            >
              <BarChart data={metrics?.timeline ?? []}>
                <ChartAxes />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar dataKey="studios" name="Novos estúdios" fill="#7c3aed" radius={[5, 5, 0, 0]} />
              </BarChart>
            </MetricChart>
          )}

          {activeView === "growth" && (
            <MetricChart
              title="Receita da Bellza"
              description="Faturas de assinatura efetivamente pagas"
              hasData={hasTimelineValue("platformRevenueCents")}
            >
              <AreaChart data={metrics?.timeline ?? []}>
                <ChartAxes money />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value: number) => [formatMoney(value), "Receita Bellza"]}
                />
                <Area
                  type="monotone"
                  dataKey="platformRevenueCents"
                  name="Receita Bellza"
                  stroke="#059669"
                  fill="#10b98122"
                  strokeWidth={2}
                />
              </AreaChart>
            </MetricChart>
          )}

          {activeView === "overview" && (
            <MetricChart
              title="Volume financeiro dos estúdios"
              description="Valor das marcações concluídas; não é receita Bellza"
              hasData={hasTimelineValue("studioVolumeCents")}
            >
              <AreaChart data={metrics?.timeline ?? []}>
                <ChartAxes money />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value: number) => [formatMoney(value), "Volume dos estúdios"]}
                />
                <Area
                  type="monotone"
                  dataKey="studioVolumeCents"
                  name="Volume dos estúdios"
                  stroke="#7c3aed"
                  fill="#8b5cf622"
                  strokeWidth={2}
                />
              </AreaChart>
            </MetricChart>
          )}

          {activeView === "appointments" && (
            <MetricChart
              title="Quantidade de marcações"
              description="Todos os estados no período selecionado"
              hasData={hasTimelineValue("appointments")}
            >
              <BarChart data={metrics?.timeline ?? []}>
                <ChartAxes />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar dataKey="appointments" name="Marcações" fill="#2563eb" radius={[5, 5, 0, 0]} />
              </BarChart>
            </MetricChart>
          )}

          {activeView === "growth" && (
            <MetricChart
              title="Conversão de testes gratuitos"
              description="Coortes iniciadas no período e convertidas em plano pago"
              hasData={hasTimelineValue("trials") || hasTimelineValue("conversions")}
            >
              <ComposedChart data={metrics?.timeline ?? []}>
                <ChartAxes />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="trials"
                  name="Testes iniciados"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="conversions"
                  name="Convertidos"
                  stroke="#059669"
                  strokeWidth={2}
                />
              </ComposedChart>
            </MetricChart>
          )}

          {activeView === "growth" && (
            <MetricChart
              title="Cancelamentos de assinaturas"
              description={`${metrics?.rates.subscriptionCancellation ?? 0}% no período`}
              hasData={hasTimelineValue("cancellations")}
            >
              <BarChart data={metrics?.timeline ?? []}>
                <ChartAxes />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar
                  dataKey="cancellations"
                  name="Cancelamentos"
                  fill="#dc2626"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </MetricChart>
          )}

          {activeView === "comparison" && !filters.studioId && (
            <MetricChart
              title="Comparação entre estúdios"
              description="Estúdios com maior volume financeiro no período"
              hasData={metrics?.rankings.byVolume.some((studio) => studio.volumeCents > 0) ?? false}
            >
              <BarChart
                data={(metrics?.rankings.byVolume ?? []).slice(0, 8).map((studio) => ({
                  name: studio.name.length > 18 ? `${studio.name.slice(0, 16)}…` : studio.name,
                  volumeCents: studio.volumeCents,
                }))}
                layout="vertical"
                margin={{ left: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => `${Math.round(value / 100)}€`} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value: number) => [formatMoney(value), "Volume"]}
                />
                <Bar dataKey="volumeCents" fill="#7c3aed" radius={[0, 5, 5, 0]} />
              </BarChart>
            </MetricChart>
          )}

          {activeView === "overview" && filters.studioId && (
            <MetricChart
              title="Evolução individual do estúdio"
              description="Volume financeiro e marcações no período"
              hasData={hasTimelineValue("studioVolumeCents") || hasTimelineValue("appointments")}
            >
              <ComposedChart data={metrics?.timeline ?? []}>
                <ChartAxes money />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value: number, name: string) => [
                    name === "Volume" ? formatMoney(value) : value,
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="studioVolumeCents"
                  name="Volume"
                  stroke="#7c3aed"
                  fill="#8b5cf622"
                />
                <Line
                  type="monotone"
                  dataKey="appointments"
                  name="Marcações"
                  stroke="#2563eb"
                  strokeWidth={2}
                />
              </ComposedChart>
            </MetricChart>
          )}
        </div>

        {activeView === "comparison" && (
          <div className="grid gap-4 lg:grid-cols-3">
            <RankingPanel
              title="Maior volume financeiro"
              rows={(metrics?.rankings.byVolume ?? []).slice(0, 8)}
              value={(row) => formatMoney(row.volumeCents)}
            />
            <RankingPanel
              title="Mais marcações"
              rows={(metrics?.rankings.byAppointments ?? []).slice(0, 8)}
              value={(row) => `${row.appointments} marcações`}
            />
            <RankingPanel
              title="Pouco ou nenhum uso"
              rows={(metrics?.rankings.lowUsage ?? []).slice(0, 8)}
              value={(row) => `${row.appointments} marcações`}
            />
          </div>
        )}
      </div>
    </CentralShell>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-xs outline-none focus:border-foreground/30"
      >
        {children}
      </select>
    </label>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none"
      />
    </label>
  );
}

function studioAccountLabel(
  studio: NonNullable<PlatformMetricsResponse["metrics"]["selectedStudio"]>,
) {
  if (
    studio.trialDaysRemaining > 0 &&
    (studio.subscriptionStatus === "trialing" ||
      studio.plan.toLowerCase().includes("trial") ||
      studio.plan.toLowerCase().includes("teste"))
  ) {
    return "Em teste";
  }
  if (studio.accountStatus === "blocked") return "Bloqueada";
  if (studio.accountStatus === "cancelled") return "Cancelada";
  return "Ativa";
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 p-3">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-xs font-semibold leading-snug">{value}</p>
    </div>
  );
}

function MetricChart({
  title,
  description,
  hasData,
  children,
}: {
  title: string;
  description: string;
  hasData: boolean;
  children: React.ReactElement;
}) {
  return (
    <Panel title={title} description={description}>
      {hasData ? (
        <div className="h-64 min-w-0 p-3 sm:h-72 sm:p-4">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState />
      )}
    </Panel>
  );
}

function ChartAxes({ money = false }: { money?: boolean }) {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        axisLine={false}
        tickLine={false}
        minTickGap={18}
      />
      <YAxis
        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        axisLine={false}
        tickLine={false}
        width={money ? 54 : 32}
        tickFormatter={money ? (value) => `${Math.round(value / 100)}€` : undefined}
        allowDecimals={false}
      />
    </>
  );
}

function RankingPanel({
  title,
  rows,
  value,
}: {
  title: string;
  rows: NonNullable<PlatformMetricsResponse["metrics"]>["studioRows"];
  value: (row: NonNullable<PlatformMetricsResponse["metrics"]>["studioRows"][number]) => string;
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-xs text-muted-foreground">Sem dados no período.</p>
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map((row, index) => (
            <div key={row.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-[10px] font-bold text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{row.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">{row.ownerName}</p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold">
                {value(row)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
