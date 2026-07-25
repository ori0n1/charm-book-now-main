import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Ban,
  Building2,
  CalendarCheck2,
  CircleOff,
  Clock3,
  Euro,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  getPlatformMetrics,
  type PlatformMetricsFilters,
  type PlatformMetricsResponse,
  type PlatformStudioRow,
} from "@/lib/platform-metrics.functions";
import {
  CentralShell,
  formatDateTime,
  formatMoney,
  MetricCard,
  Panel,
  StatusBadge,
} from "@/components/central/central-ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/central")({
  head: () => ({ meta: [{ title: "Central Bellza" }] }),
  component: CentralPage,
});

const CENTRAL_FILTERS: PlatformMetricsFilters = {
  studioId: null,
  preset: "30d",
  from: null,
  to: null,
  plan: "all",
  accountStatus: "all",
  subscriptionStatus: "all",
};

const PLAN_LABELS: Record<string, string> = {
  trial: "Teste gratuito",
  monthly: "Mensal",
  quarterly: "Trimestral",
  yearly: "Anual",
  pro: "Premium",
};

const SUBSCRIPTION_LABELS: Record<string, string> = {
  trialing: "Em teste",
  active: "Ativa",
  past_due: "Vencida",
  unpaid: "Não paga",
  incomplete: "Incompleta",
  incomplete_expired: "Expirada",
  paused: "Pausada",
  canceled: "Cancelada",
};

function accountBadge(row: PlatformStudioRow) {
  if (row.accountStatus === "active") {
    return <StatusBadge value="Ativa" kind="success" />;
  }
  if (row.accountStatus === "blocked") {
    return <StatusBadge value="Bloqueada" kind="danger" />;
  }
  return <StatusBadge value="Cancelada" kind="neutral" />;
}

function subscriptionKind(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "trialing") return "warning";
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(status)) return "danger";
  return "neutral";
}

function CentralPage() {
  const fetchMetrics = useServerFn(getPlatformMetrics);
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const query = useQuery<PlatformMetricsResponse>({
    queryKey: ["platform-central", CENTRAL_FILTERS],
    queryFn: () => fetchMetrics({ data: CENTRAL_FILTERS }),
    staleTime: 60_000,
    retry: 1,
  });
  const metrics = query.data?.metrics;

  const visibleStudios = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt");
    return (metrics?.studioRows ?? [])
      .filter((studio) => accountFilter === "all" || studio.accountStatus === accountFilter)
      .filter((studio) => {
        if (!normalizedSearch) return true;
        return [studio.name, studio.ownerName, studio.email]
          .join(" ")
          .toLocaleLowerCase("pt")
          .includes(normalizedSearch);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [accountFilter, metrics?.studioRows, search]);

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
        <section className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Operação geral
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
              Central Bellza
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Estado das contas, assinaturas, atividade e resultados dos estúdios cadastrados.
            </p>
          </div>
          <Link
            to="/admin/central-metricas"
            search={{ studio: undefined }}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-xs font-semibold text-background shadow-sm"
          >
            <TrendingUp className="h-4 w-4" />
            Abrir métricas detalhadas
          </Link>
        </section>

        {query.isError && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
            Não foi possível carregar a Central. Confirme a permissão administrativa e tente
            novamente.
          </div>
        )}

        <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-8">
          <MetricCard
            label="Estúdios"
            value={metrics?.studios.total ?? 0}
            hint="Total cadastrado"
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
            hint="Assinatura cancelada"
            icon={CircleOff}
            loading={query.isLoading}
          />
          <MetricCard
            label="Em teste"
            value={metrics?.studios.trial ?? 0}
            hint="Teste gratuito"
            icon={Clock3}
            accent="amber"
            loading={query.isLoading}
          />
          <MetricCard
            label="Assinaturas ativas"
            value={metrics?.studios.paidActive ?? 0}
            hint="Planos pagos"
            icon={TrendingUp}
            accent="blue"
            loading={query.isLoading}
          />
          <MetricCard
            label="Receita Bellza"
            value={formatMoney(metrics?.finances.platformRevenueCents ?? 0)}
            hint="Assinaturas · 30 dias"
            icon={Euro}
            accent="emerald"
            money
            loading={query.isLoading}
          />
          <MetricCard
            label="Volume dos estúdios"
            value={formatMoney(metrics?.finances.studioVolumeCents ?? 0)}
            hint="Marcações concluídas · 30 dias"
            icon={Euro}
            accent="violet"
            money
            loading={query.isLoading}
          />
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.65fr)]">
          <Panel
            title="Estúdios cadastrados"
            description={`${visibleStudios.length} conta${visibleStudios.length === 1 ? "" : "s"} encontrada${visibleStudios.length === 1 ? "" : "s"}`}
            action={
              <Link
                to="/admin/central-metricas"
                search={{ studio: undefined }}
                className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                Comparar métricas
              </Link>
            }
          >
            <div className="grid gap-2 border-b border-border/60 p-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Pesquisar estúdio, responsável ou e-mail"
                  className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-foreground/30"
                />
              </label>
              <select
                value={accountFilter}
                onChange={(event) => setAccountFilter(event.target.value)}
                className="h-10 rounded-xl border border-border bg-background px-3 text-xs outline-none"
              >
                <option value="all">Todas as contas</option>
                <option value="active">Ativas</option>
                <option value="blocked">Bloqueadas</option>
                <option value="cancelled">Canceladas</option>
              </select>
            </div>

            <div className="max-h-[42rem] overflow-auto">
              {query.isLoading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded-xl bg-muted/60" />
                  ))}
                </div>
              ) : visibleStudios.length === 0 ? (
                <p className="p-8 text-center text-xs text-muted-foreground">
                  Nenhum estúdio corresponde aos filtros.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {visibleStudios.map((studio) => (
                    <article
                      key={studio.id}
                      className="grid gap-3 px-4 py-3.5 transition hover:bg-muted/20 lg:grid-cols-[minmax(12rem,1.3fr)_minmax(9rem,0.7fr)_minmax(10rem,0.8fr)_auto] lg:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold">{studio.name}</p>
                          {accountBadge(studio)}
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          {studio.ownerName} · {studio.email}
                        </p>
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-2 lg:block">
                        <StatusBadge
                          value={SUBSCRIPTION_LABELS[studio.subscriptionStatus] || studio.subscriptionStatus}
                          kind={subscriptionKind(studio.subscriptionStatus)}
                        />
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {PLAN_LABELS[studio.plan] || studio.plan}
                          {studio.plan === "trial" && ` · ${studio.trialDaysRemaining} dias`}
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-left">
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            Volume
                          </p>
                          <p className="whitespace-nowrap text-xs font-semibold">
                            {formatMoney(studio.volumeCents)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            Marcações
                          </p>
                          <p className="text-xs font-semibold">{studio.appointments}</p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            Clientes
                          </p>
                          <p className="text-xs font-semibold">{studio.clients}</p>
                        </div>
                      </div>
                      <Link
                        to="/admin/central-metricas"
                        search={{ studio: studio.id }}
                        className="inline-flex min-h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-[11px] font-semibold hover:border-foreground/30"
                      >
                        Analisar
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <Panel
              title="Pouco ou nenhum uso"
              description="Até 2 marcações nos últimos 30 dias"
            >
              <CompactStudioList
                rows={metrics?.rankings.lowUsage ?? []}
                empty="Nenhuma conta com baixo uso."
                value={(studio) => `${studio.appointments} marcações`}
              />
            </Panel>
            <Panel title="Contas inativas" description="Sem acesso há mais de 30 dias">
              <CompactStudioList
                rows={metrics?.rankings.inactive ?? []}
                empty="Nenhuma conta inativa."
                value={(studio) => formatDateTime(studio.lastAccessAt, studio.timezone)}
              />
            </Panel>
            <Panel title="Mais marcações" description="Desempenho dos últimos 30 dias">
              <CompactStudioList
                rows={metrics?.rankings.byAppointments.slice(0, 6) ?? []}
                empty="Sem marcações no período."
                value={(studio) => `${studio.appointments} marcações`}
                icon={Users}
              />
            </Panel>
          </div>
        </div>
      </div>
    </CentralShell>
  );
}

function CompactStudioList({
  rows,
  empty,
  value,
  icon: Icon = Clock3,
}: {
  rows: PlatformStudioRow[];
  empty: string;
  value: (studio: PlatformStudioRow) => string;
  icon?: typeof Clock3;
}) {
  if (rows.length === 0) {
    return <p className="p-6 text-center text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="divide-y divide-border/60">
      {rows.slice(0, 8).map((studio) => (
        <Link
          key={studio.id}
          to="/admin/central-metricas"
          search={{ studio: studio.id }}
          className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/20"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{studio.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">{studio.ownerName}</p>
          </div>
          <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
            {value(studio)}
          </span>
        </Link>
      ))}
    </div>
  );
}
