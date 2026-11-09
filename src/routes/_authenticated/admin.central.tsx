import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Ban,
  Building2,
  Clock3,
  Euro,
  MessageCircle,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";
import { getCentralOverview, type CentralStudio } from "@/lib/platform-central.functions";
import { getCentralAccessSnapshot } from "@/lib/platform-central-access.functions";
import { centralVolumeWithoutAccount } from "@/lib/platform-central-access-core";
import {
  CentralShell,
  formatMoney,
  MetricCard,
  Panel,
  StatusBadge,
} from "@/components/central/central-ui";

export const Route = createFileRoute("/_authenticated/admin/central")({
  head: () => ({ meta: [{ title: "Central Bellza" }] }),
  component: CentralPage,
});

const PLAN_LABELS: Record<string, string> = {
  trial: "Teste gratuito",
  monthly: "Mensal",
  quarterly: "Trimestral",
  yearly: "Anual",
  pro: "Premium",
};
const STATUS_LABELS: Record<string, string> = {
  trialing: "Em teste",
  active: "Ativa",
  past_due: "Pagamento em atraso",
  unpaid: "Não paga",
  incomplete: "Incompleta",
  incomplete_expired: "Expirada",
  paused: "Pausada",
  canceled: "Cancelada",
};

function subscriptionKind(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "trialing") return "warning";
  if (["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(status))
    return "danger";
  return "neutral";
}

function accountBadge(row: CentralStudio) {
  if (row.accountStatus === "active") return <StatusBadge value="Ativa" kind="success" />;
  if (row.accountStatus === "blocked") return <StatusBadge value="Bloqueada" kind="danger" />;
  return <StatusBadge value="Cancelada" />;
}

function CentralPage() {
  const fetchOverview = useServerFn(getCentralOverview);
  const fetchAccess = useServerFn(getCentralAccessSnapshot);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("qualified");
  const query = useQuery({
    queryKey: ["platform-central-overview"],
    queryFn: () => fetchOverview(),
    staleTime: 60_000,
    retry: 1,
  });
  const accessQuery = useQuery({
    queryKey: ["platform-central-access"],
    queryFn: () => fetchAccess(),
    staleTime: 60_000,
    retry: 1,
  });
  const overview = query.data;
  const access = accessQuery.data;
  const businessRows = useMemo(
    () => (overview?.studios ?? []).filter((row) => row.isBusinessActive === true),
    [overview?.studios],
  );
  const businessIds = useMemo(() => new Set(businessRows.map((row) => row.id)), [businessRows]);
  const businessActivity = !overview || overview.counts.businessActive === null ? null : {
    appointments: businessRows.reduce((total, row) => total + (row.appointments ?? 0), 0),
    completed: businessRows.reduce((total, row) => total + (row.completedAppointments ?? 0), 0),
  };
  const accessByStudio = useMemo(
    () => new Map(access?.studios.map((studio) => [studio.studioId, studio]) ?? []),
    [access],
  );
  const visibleVolume = useMemo(
    () => overview?.counts.businessActive !== null && overview?.activity
      ? centralVolumeWithoutAccount(overview.studios, access, businessIds) : null,
    [overview, access, businessIds],
  );
  const excludedIds = useMemo(() => new Set(access?.excludedStudioIds ?? []), [access]);
  const inactiveStudios = useMemo(
    () => businessRows
      .filter((row) => !excludedIds.has(row.id) && ["inactive", "never"].includes(accessByStudio.get(row.id)?.state ?? ""))
      .sort((a, b) => a.name.localeCompare(b.name, "pt")),
    [businessRows, excludedIds, accessByStudio],
  );
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt");
    return (overview?.studios ?? [])
      .filter(
        (row) =>
          filter === "all" ||
          ((filter === "blocked" || filter === "cancelled") && row.accountStatus === filter) ||
          (filter === "qualified" && row.isBusinessActive === true) ||
          (filter === "payment"
            ? row.isBusinessActive === true && ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(
                row.subscriptionStatus,
              )
            : filter === "inactive" || filter === "never"
              ? row.isBusinessActive === true && !excludedIds.has(row.id) && accessByStudio.get(row.id)?.state === filter
            : filter === "trial"
              ? row.isBusinessActive === true && row.subscriptionStatus === "trialing"
              : row.isBusinessActive === true && row.accountStatus === filter),
      )
      .filter(
        (row) =>
          !needle ||
          [row.name, row.ownerName, row.email].join(" ").toLocaleLowerCase("pt").includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [overview?.studios, filter, search, excludedIds, accessByStudio]);
  const expiring =
    businessRows
      .filter((row) => row.subscriptionStatus === "trialing" && row.trialDaysRemaining <= 3)
      .sort((a, b) => a.trialDaysRemaining - b.trialDaysRemaining);
  const paymentIssues =
    businessRows
      .filter((row) =>
        ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(
          row.subscriptionStatus,
        ),
      );
  const unavailable = "—";

  return (
    <CentralShell
      updatedAt={overview?.generatedAt}
      actions={
        <button
          type="button"
          onClick={() => { void query.refetch(); void accessQuery.refetch(); }}
          disabled={query.isFetching || accessQuery.isFetching}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      }
    >
      <div className="space-y-4">
        <section className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Operação geral
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
              Central Bellza
            </h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Contas, assinaturas e saúde financeira da plataforma em um só lugar.
            </p>
            {overview && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Atividade e receita: {overview.period.label}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/central-whatsapp"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-4 text-xs font-semibold"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </Link>
            <Link
              to="/admin/central-metricas"
              search={{ studio: undefined }}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-xs font-semibold text-background"
            >
              <TrendingUp className="h-4 w-4" />
              Métricas detalhadas
            </Link>
          </div>
        </section>

        {query.isError && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300"
          >
            Não foi possível carregar as contas da Central. Verifique a ligação e tente atualizar.
            Se o problema continuar, confirme a função de administração da plataforma.
          </div>
        )}
        {accessQuery.isError && (
          <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
            Últimos acessos e exclusão do volume indisponíveis. Atualize a Central para tentar novamente.
          </div>
        )}
        {access && !access.excludedAccountFound && (
          <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
            A conta silas18.so@gmail.com não foi identificada. O volume total fica oculto até confirmar a exclusão.
          </div>
        )}
        {overview?.issues.map((issue) => (
          <div
            key={issue}
            role="status"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200"
          >
            {issue} Os demais dados continuam disponíveis.
          </div>
        ))}

        <section
          className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-8"
          aria-label="Resumo da plataforma"
        >
          <MetricCard
            label="Com movimento"
            value={overview?.counts.businessActive ?? unavailable}
            hint="Ativos · clientes e volume"
            icon={Building2}
            accent="violet"
            loading={query.isLoading}
          />
          <MetricCard
            label="Clientes"
            value={overview?.counts.businessClients ?? unavailable}
            hint="Nos estúdios com movimento"
            icon={Users}
            accent="emerald"
            loading={query.isLoading}
          />
          <MetricCard
            label="Bloqueados"
            value={overview?.counts.blocked ?? unavailable}
            hint="Acesso desativado"
            icon={Ban}
            accent="red"
            loading={query.isLoading}
          />
          <MetricCard
            label="Em teste"
            value={overview?.counts.businessTrial ?? unavailable}
            hint="Com clientes e volume"
            icon={Clock3}
            accent="amber"
            loading={query.isLoading}
          />
          <MetricCard
            label="Pagas ativas"
            value={overview?.counts.businessPaidActive ?? unavailable}
            hint="Com clientes e volume"
            icon={TrendingUp}
            accent="blue"
            loading={query.isLoading}
          />
          <MetricCard
            label="Atenção"
            value={overview?.counts.businessAttention ?? unavailable}
            hint="Pendências com movimento"
            icon={AlertTriangle}
            accent="amber"
            loading={query.isLoading}
          />
          <MetricCard
            label="Receita Bellza"
            value={overview?.billing ? formatMoney(overview.billing.revenueCents) : unavailable}
            hint="Faturas pagas · 30 dias"
            icon={Euro}
            accent="emerald"
            money
            loading={query.isLoading}
          />
          <MetricCard
            label="Volume estúdios"
            value={visibleVolume ? formatMoney(visibleVolume.visibleCents) : unavailable}
            hint="Com clientes · sem conta silas18.so@gmail.com"
            icon={Euro}
            accent="violet"
            money
            loading={query.isLoading || accessQuery.isLoading}
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.7fr)]">
          <Panel
            title="Estúdios com movimento"
            description={
              overview
                ? `${rows.length} na lista · ${overview.counts.total} contas cadastradas no total`
                : "Lista de contas"
            }
          >
            <div className="grid gap-2 border-b border-border/60 p-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Pesquisar estúdio ou e-mail"
                  className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-foreground/30"
                />
              </label>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="Filtrar contas"
                className="h-10 rounded-xl border border-border bg-background px-3 text-xs"
              >
                <option value="qualified">Com clientes e volume</option>
                <option value="all">Todas cadastradas</option>
                <option value="active">Ativas</option>
                <option value="blocked">Bloqueadas</option>
                <option value="cancelled">Canceladas</option>
                <option value="trial">Em teste</option>
                <option value="payment">Cobrança pendente</option>
                <option value="inactive">Sem login há 30 dias</option>
                <option value="never">Sem login registado</option>
              </select>
            </div>
            <div className="max-h-[40rem] overflow-auto">
              {query.isLoading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="h-16 animate-pulse rounded-xl bg-muted/60" />
                  ))}
                </div>
              ) : !overview ? (
                <p className="p-8 text-center text-xs text-muted-foreground">
                  Contas indisponíveis.
                </p>
              ) : overview.counts.businessActive === null && filter === "qualified" ? (
                <p className="p-8 text-center text-xs text-muted-foreground">
                  Não foi possível verificar clientes e volume. Atualize para tentar novamente.
                </p>
              ) : rows.length === 0 ? (
                <p className="p-8 text-center text-xs text-muted-foreground">
                  Nenhum estúdio corresponde aos filtros.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {rows.map((row) => (
                    <article
                      key={row.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/20"
                    >
                      <div className="min-w-44 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{row.name}</p>
                          {accountBadge(row)}
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          {row.ownerName} · {row.email}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {excludedIds.has(row.id) ? "Volume excluído do total · " : ""}
                          {accessByStudio.get(row.id)?.lastAccessAt
                            ? `Último login: ${new Date(accessByStudio.get(row.id)!.lastAccessAt!).toLocaleDateString("pt-PT")}`
                            : accessByStudio.get(row.id)?.state === "never"
                              ? "Sem login registado"
                              : "Último login desconhecido"}
                        </p>
                      </div>
                      <div className="min-w-28">
                        <StatusBadge
                          value={STATUS_LABELS[row.subscriptionStatus] || row.subscriptionStatus}
                          kind={subscriptionKind(row.subscriptionStatus)}
                        />
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {PLAN_LABELS[row.plan] || row.plan}
                          {row.subscriptionStatus === "trialing" &&
                            ` · ${row.trialDaysRemaining} dias`}
                        </p>
                      </div>
                      <div className="min-w-24 text-xs">
                        <p className="font-semibold">{row.appointments ?? "—"} marcações</p>
                        <p className="text-[10px] text-muted-foreground">
                          {row.volumeCents === null
                            ? "Volume indisponível"
                            : formatMoney(row.volumeCents)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{row.clients ?? "—"} clientes</p>
                      </div>
                      <Link
                        to="/admin/central-metricas"
                        search={{ studio: row.id }}
                        className="inline-flex min-h-9 items-center rounded-xl border border-border px-3 text-[11px] font-semibold"
                      >
                        Analisar
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </Panel>
          <div className="space-y-4">
            <Panel title="Sem acesso recente" description="Estúdios com movimento · último login há 30 dias">
              {!access || !overview || overview.counts.businessActive === null ? (
                <p className="p-4 text-xs text-muted-foreground">Dados de acesso indisponíveis.</p>
              ) : inactiveStudios.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">Nenhum estúdio com movimento nesta condição.</p>
              ) : (
                <div className="max-h-80 overflow-auto divide-y divide-border/60">
                  {inactiveStudios.map((row) => {
                    const studioAccess = accessByStudio.get(row.id)!;
                    return <div key={row.id} className="px-4 py-2 text-xs">
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-muted-foreground">{studioAccess.ownerEmail || row.email} · {studioAccess.lastAccessAt
                        ? `Último login: ${new Date(studioAccess.lastAccessAt).toLocaleDateString("pt-PT")}`
                        : "Sem login registado"}</p>
                    </div>;
                  })}
                </div>
              )}
            </Panel>
            <Panel title="Volume excluído" description="Conta silas18.so@gmail.com · últimos 30 dias">
              <div className="p-4 text-xs">
                <p className="text-xl font-semibold">{visibleVolume ? formatMoney(visibleVolume.excludedCents) : "—"}</p>
                <p className="mt-1 text-muted-foreground">{access?.excludedStudioIds.length ?? "—"} estúdio(s) vinculado(s): {overview && access
                  ? overview.studios.filter((row) => excludedIds.has(row.id)).map((row) => row.name).join(", ") || "nenhum"
                  : "indisponível"}</p>
              </div>
            </Panel>
            <Panel title="Atenção operacional" description="Pendências que merecem acompanhamento">
              <div className="grid grid-cols-2 gap-3 p-4 text-center">
                <div className="rounded-xl bg-amber-500/5 p-3">
                  <p className="text-2xl font-semibold">{!overview || overview.counts.businessActive === null ? "—" : expiring.length}</p>
                  <p className="text-[10px] text-muted-foreground">Testes com movimento vencidos ou a vencer</p>
                </div>
                <div className="rounded-xl bg-red-500/5 p-3">
                  <p className="text-2xl font-semibold">{!overview || overview.counts.businessActive === null ? "—" : paymentIssues.length}</p>
                  <p className="text-[10px] text-muted-foreground">Cobranças pendentes com movimento</p>
                </div>
              </div>
              {[...paymentIssues, ...expiring].slice(0, 8).map((row) => (
                <Link
                  key={row.id}
                  to="/admin/central-metricas"
                  search={{ studio: row.id }}
                  className="flex justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs hover:bg-muted/20"
                >
                  <span className="truncate font-semibold">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {row.subscriptionStatus === "trialing"
                      ? `${row.trialDaysRemaining} dias`
                      : STATUS_LABELS[row.subscriptionStatus] || row.subscriptionStatus}
                  </span>
                </Link>
              ))}
              {overview && overview.counts.businessActive !== null && !paymentIssues.length && !expiring.length && (
                <p className="px-4 pb-4 text-xs text-muted-foreground">
                  Nenhuma pendência encontrada.
                </p>
              )}
            </Panel>
            <Panel title="Atividade dos últimos 30 dias" description="Marcações dos estúdios com clientes e volume">
              <div className="grid grid-cols-2 gap-3 p-4 text-center">
                <div>
                  <p className="text-xl font-semibold">{businessActivity?.appointments ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground">Marcações</p>
                </div>
                <div>
                  <p className="text-xl font-semibold">{businessActivity?.completed ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground">Concluídas</p>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </CentralShell>
  );
}
