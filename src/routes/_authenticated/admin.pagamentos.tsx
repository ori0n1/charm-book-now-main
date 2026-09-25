import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Filter,
  Info,
  RefreshCw,
  UserRound,
  Wallet,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { BrandLoadingState } from "@/components/brand-loading-state";
import { ExpandableList } from "@/components/ui/expandable-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  getFinancialReport,
  type FinancialPeriodPreset,
  type FinancialReportPayload,
} from "@/lib/financial-report.functions";
import { ADMIN_REFERENCE_GC_MS, ADMIN_REFERENCE_STALE_MS } from "@/lib/admin-query-cache";
import { cn, formatEUR } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/pagamentos")({
  head: () => ({ meta: [{ title: "Financeiro - Painel" }] }),
  component: PaymentsPage,
});

type FinanceFilters = {
  period: FinancialPeriodPreset;
  startDate: string;
  endDate: string;
  staffId: string;
  paymentMethod: string;
  source: "all" | "appointment" | "manual" | "walk_in";
};

const DEFAULT_FILTERS: FinanceFilters = {
  period: "this_month",
  startDate: "",
  endDate: "",
  staffId: "all",
  paymentMethod: "all",
  source: "all",
};

const PERIOD_OPTIONS: Array<{ value: FinancialPeriodPreset; label: string }> = [
  { value: "this_month", label: "Este mês" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "this_year", label: "Este ano" },
  { value: "all", label: "Todo o histórico" },
  { value: "custom", label: "Período personalizado" },
];

const PAYMENT_METHODS = [
  { value: "cash", label: "Dinheiro" },
  { value: "mb_way", label: "MB Way" },
  { value: "multibanco", label: "Multibanco" },
  { value: "card", label: "Cartão" },
  { value: "bank_transfer", label: "Transferência" },
  { value: "other", label: "Outro" },
];

function PaymentsPage() {
  const { studio, loading: studioLoading } = useCurrentStudio();
  const loadReport = useServerFn(getFinancialReport);
  const [filters, setFilters] = useState<FinanceFilters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<FinanceFilters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const customPeriodReady =
    filters.period !== "custom" || Boolean(filters.startDate && filters.endDate);
  const queryKey = useMemo(
    () => [
      "financial-report",
      studio?.id ?? null,
      filters.period,
      filters.startDate,
      filters.endDate,
      filters.staffId,
      filters.paymentMethod,
      filters.source,
    ],
    [filters, studio?.id],
  );
  const reportQuery = useQuery({
    queryKey,
    enabled: Boolean(studio?.id && customPeriodReady),
    staleTime: ADMIN_REFERENCE_STALE_MS,
    gcTime: ADMIN_REFERENCE_GC_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async () =>
      (await loadReport({
        data: {
          studioId: studio!.id,
          period: filters.period,
          startDate: filters.startDate || null,
          endDate: filters.endDate || null,
          staffId: filters.staffId === "all" ? null : filters.staffId,
          paymentMethod:
            filters.paymentMethod === "all"
              ? null
              : (filters.paymentMethod as
                  | "cash"
                  | "mb_way"
                  | "multibanco"
                  | "card"
                  | "bank_transfer"
                  | "other"),
          source: filters.source,
        },
      })) as FinancialReportPayload,
  });

  const openFilters = () => {
    setDraftFilters(filters);
    setFilterOpen(true);
  };
  const activeFilterCount =
    Number(filters.staffId !== "all") +
    Number(filters.paymentMethod !== "all") +
    Number(filters.source !== "all");

  if (studioLoading || (reportQuery.isLoading && !reportQuery.data)) {
    return <BrandLoadingState label="A reconciliar o financeiro" />;
  }
  if (!studio) {
    return <FinanceError message="Não foi possível identificar o estúdio desta sessão." />;
  }
  if (reportQuery.error) {
    return (
      <FinanceError
        message="Não foi possível carregar os valores financeiros com segurança."
        onRetry={() => void reportQuery.refetch()}
      />
    );
  }

  const report = reportQuery.data;
  const periodLabel =
    report?.period.label ??
    PERIOD_OPTIONS.find((option) => option.value === filters.period)?.label ??
    "Período";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 pb-4 md:space-y-4">
      <header className="rounded-[1.5rem] border border-emerald-700/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.11),rgba(255,255,255,0.02)_58%,rgba(16,185,129,0.04))] px-4 py-4 shadow-sm md:px-5 md:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-400">
              Financeiro
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
              Visão financeira
            </h1>
            <p className="mt-1 text-xs text-muted-foreground md:text-sm">
              Valores do período dos atendimentos · {periodLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reportQuery.refetch()}
            disabled={reportQuery.isFetching}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-border/80 bg-background/85 text-muted-foreground shadow-sm transition hover:text-foreground disabled:opacity-50"
            aria-label="Atualizar financeiro"
          >
            <RefreshCw className={cn("size-4", reportQuery.isFetching && "animate-spin")} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex">
          <Select
            value={filters.period}
            onValueChange={(value) => {
              const period = value as FinancialPeriodPreset;
              if (period === "custom") {
                setDraftFilters({ ...filters, period });
                setFilterOpen(true);
                return;
              }
              setFilters((current) => ({ ...current, period, startDate: "", endDate: "" }));
            }}
          >
            <SelectTrigger
              aria-label="Período do financeiro"
              className="h-10 min-w-0 rounded-full border-border/80 bg-background/90 px-4 text-xs font-semibold shadow-sm sm:w-[12rem]"
            >
              <CalendarDays className="mr-2 size-3.5 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-2xl p-1.5">
              {PERIOD_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="rounded-xl">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={openFilters}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border/80 bg-background/90 px-4 text-xs font-semibold shadow-sm transition hover:border-emerald-700/25"
          >
            <Filter className="size-3.5" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-emerald-700 text-[10px] text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {report && (
        <>
          <section
            data-finance-summary
            className="grid grid-cols-2 gap-2.5 md:gap-3"
            aria-label="Resumo financeiro"
          >
            <article
              data-finance-kpi="received"
              className="min-w-0 rounded-[1.35rem] border border-emerald-700/20 bg-card p-3.5 shadow-sm md:p-5"
            >
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <Wallet className="size-4" />
                <p className="text-[10px] font-bold uppercase tracking-[0.16em]">Recebido</p>
              </div>
              <Money cents={report.summary.receivedCents} className="mt-2 text-xl sm:text-2xl md:text-3xl" />
              <dl className="mt-3 space-y-1 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
                <BreakdownLine label="Online" cents={report.summary.receivedOnlineCents} />
                <BreakdownLine label="Presencial" cents={report.summary.receivedOnsiteCents} />
              </dl>
            </article>

            <article
              data-finance-kpi="pending"
              className="min-w-0 rounded-[1.35rem] border border-border bg-card p-3.5 shadow-sm md:p-5"
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <CircleAlert className="size-4" />
                <p className="text-[10px] font-bold uppercase tracking-[0.16em]">A receber</p>
              </div>
              <Money cents={report.summary.pendingCents} className="mt-2 text-xl sm:text-2xl md:text-3xl" />
              <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-snug text-muted-foreground">
                Saldo de marcações confirmadas ou concluídas ainda não recebido.
              </p>
            </article>
          </section>

          <article
            data-finance-kpi="realized"
            className="flex items-center justify-between gap-4 rounded-[1.25rem] border border-border bg-card px-4 py-3.5 shadow-sm md:px-5 md:py-4"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Receita realizada
                </p>
                <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Atendimentos efetivamente concluídos no período.
              </p>
            </div>
            <Money cents={report.summary.realizedCents} className="shrink-0 text-xl md:text-2xl" />
          </article>

          {filters.paymentMethod !== "all" && (
            <p className="rounded-xl border border-blue-500/15 bg-blue-500/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              A forma de pagamento filtra “Recebido” e o respetivo detalhamento. “Receita realizada” e “A receber” não dependem do meio usado para pagar.
            </p>
          )}

          <OnlinePaymentDetails refundedCents={report.summary.refundedCents} />

          <section className="overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border/65 px-4 py-3.5 md:px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                  <UserRound className="size-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Recebido por profissional</h2>
                  <p className="text-[11px] text-muted-foreground">
                    Reconcilia com o total recebido acima.
                  </p>
                </div>
              </div>
              <Money cents={report.summary.receivedCents} className="shrink-0 text-sm md:text-base" />
            </div>
            <StaffReceivedList members={report.byStaff} />
          </section>

          <details className="group overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-sm">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden md:px-5">
              <span>
                <span className="block">Histórico de serviços avulsos</span>
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {report.manualEntries.length} lançamento{report.manualEntries.length === 1 ? "" : "s"} no filtro
                </span>
              </span>
              <span className="text-lg font-light text-muted-foreground transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="border-t border-border/65 p-3 md:p-4">
              <ManualEntries entries={report.manualEntries} />
            </div>
          </details>
        </>
      )}

      <FilterSheet
        open={filterOpen}
        filters={draftFilters}
        staffOptions={report?.staffOptions ?? []}
        onOpenChange={setFilterOpen}
        onChange={setDraftFilters}
        onApply={() => {
          setFilters(draftFilters);
          setFilterOpen(false);
        }}
        onReset={() => {
          setDraftFilters(DEFAULT_FILTERS);
          setFilters(DEFAULT_FILTERS);
          setFilterOpen(false);
        }}
      />
    </div>
  );
}

function Money({ cents, className }: { cents: number; className?: string }) {
  return (
    <p
      data-finance-cents={cents}
      className={cn("whitespace-nowrap font-semibold tabular-nums tracking-[-0.03em] text-emerald-700 dark:text-emerald-400", className)}
    >
      {formatEUR(cents / 100)}
    </p>
  );
}

function BreakdownLine({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt>{label}</dt>
      <dd data-finance-cents={cents} className="whitespace-nowrap font-semibold tabular-nums text-foreground">{formatEUR(cents / 100)}</dd>
    </div>
  );
}

function OnlinePaymentDetails({ refundedCents }: { refundedCents: number }) {
  return (
    <details className="group overflow-hidden rounded-[1.15rem] border border-border/80 bg-card/80">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs font-semibold [&::-webkit-details-marker]:hidden md:px-5">
        <span className="flex items-center gap-2">
          <CreditCard className="size-3.5 text-muted-foreground" />
          Como funcionam os pagamentos online
          <Info className="size-3.5 text-muted-foreground" />
        </span>
        <span className="text-base font-light text-muted-foreground transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="border-t border-border/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground md:px-5">
        <p>
          “Online” é o valor bruto confirmado pela Stripe para as marcações do período, menos reembolsos concluídos. As taxas, o líquido e os repasses são apresentados separadamente para não misturar conceitos.
        </p>
        {refundedCents > 0 && (
          <p className="mt-2">Reembolsos abatidos neste universo: {formatEUR(refundedCents / 100)}.</p>
        )}
        <Link
          to="/admin/recebimento"
          search={{ connect: undefined }}
          className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 font-semibold text-foreground"
        >
          Ver Stripe e repasses <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </details>
  );
}

function StaffReceivedList({ members }: { members: FinancialReportPayload["byStaff"] }) {
  if (members.length === 0) {
    return <p className="px-4 py-7 text-center text-sm text-muted-foreground">Sem recebimentos para os filtros selecionados.</p>;
  }
  return (
    <ExpandableList
      items={members}
      initialCount={4}
      className="divide-y divide-border/60"
      getKey={(member) => member.id}
      moreLabel={(hidden) => `Ver mais ${hidden} profissional${hidden === 1 ? "" : "is"}`}
      renderItem={(member) => (
        <article
          data-staff-received-cents={member.receivedCents}
          className="grid min-h-[4.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 md:px-5"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{member.name}</p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              Online {formatEUR(member.onlineCents / 100)} · Presencial {formatEUR(member.onsiteCents / 100)}
            </p>
          </div>
          <Money cents={member.receivedCents} className="text-base md:text-lg" />
        </article>
      )}
    />
  );
}

function ManualEntries({ entries }: { entries: FinancialReportPayload["manualEntries"] }) {
  if (entries.length === 0) {
    return <p className="rounded-xl bg-muted/25 px-4 py-6 text-center text-sm text-muted-foreground">Sem serviços avulsos para os filtros selecionados.</p>;
  }
  return (
    <ExpandableList
      items={entries}
      initialCount={6}
      className="space-y-2"
      getKey={(entry) => entry.id}
      moreLabel={(hidden) => `Ver mais ${hidden} lançamento${hidden === 1 ? "" : "s"}`}
      renderItem={(entry) => (
        <article className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/65 bg-background/55 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{entry.serviceName || "Serviço"}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {entry.staffName || "Profissional"} · {paymentMethodLabel(entry.payment_method)} · {formatDate(entry.performed_at)}
            </p>
          </div>
          <Money cents={Math.round(Number(entry.amount) * 100)} className="text-sm" />
        </article>
      )}
    />
  );
}

function FilterSheet({
  open,
  filters,
  staffOptions,
  onOpenChange,
  onChange,
  onApply,
  onReset,
}: {
  open: boolean;
  filters: FinanceFilters;
  staffOptions: FinancialReportPayload["staffOptions"];
  onOpenChange: (open: boolean) => void;
  onChange: (filters: FinanceFilters) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const customDatesValid =
    filters.period !== "custom" ||
    Boolean(filters.startDate && filters.endDate && filters.startDate <= filters.endDate);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] rounded-t-[1.75rem] border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 sm:bottom-4 sm:left-auto sm:right-4 sm:w-[26rem] sm:rounded-[1.5rem] sm:border"
      >
        <SheetHeader className="pr-10 text-left">
          <SheetTitle>Filtros do financeiro</SheetTitle>
          <SheetDescription>
            Período, profissional e tipo aplicam-se a todo o relatório. A forma de pagamento aplica-se aos valores recebidos.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 grid gap-4">
          <FilterField label="Período">
            <Select
              value={filters.period}
              onValueChange={(period) => onChange({ ...filters, period: period as FinancialPeriodPreset })}
            >
              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          {filters.period === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <FilterField label="Desde">
                <input
                  aria-label="Início do período financeiro"
                  type="date"
                  value={filters.startDate}
                  max={filters.endDate || undefined}
                  onChange={(event) => onChange({ ...filters, startDate: event.target.value })}
                  className="h-11 min-w-0 rounded-xl border border-input bg-background px-3 text-sm"
                />
              </FilterField>
              <FilterField label="Até">
                <input
                  aria-label="Fim do período financeiro"
                  type="date"
                  value={filters.endDate}
                  min={filters.startDate || undefined}
                  onChange={(event) => onChange({ ...filters, endDate: event.target.value })}
                  className="h-11 min-w-0 rounded-xl border border-input bg-background px-3 text-sm"
                />
              </FilterField>
            </div>
          )}

          <FilterField label="Profissional">
            <Select value={filters.staffId} onValueChange={(staffId) => onChange({ ...filters, staffId })}>
              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as profissionais</SelectItem>
                {staffOptions.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Forma de pagamento">
            <Select value={filters.paymentMethod} onValueChange={(paymentMethod) => onChange({ ...filters, paymentMethod })}>
              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as formas</SelectItem>
                {PAYMENT_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Tipo">
            <Select value={filters.source} onValueChange={(source) => onChange({ ...filters, source: source as FinanceFilters["source"] })}>
              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os atendimentos</SelectItem>
                <SelectItem value="appointment">Marcações</SelectItem>
                <SelectItem value="manual">Serviços com cliente</SelectItem>
                <SelectItem value="walk_in">Serviços avulsos</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </div>

        {!customDatesValid && <p className="mt-3 text-xs text-destructive">Escolha um intervalo de datas válido.</p>}
        <SheetFooter className="mt-6 grid grid-cols-2 gap-2">
          <SheetClose asChild>
            <button type="button" onClick={onReset} className="min-h-11 rounded-xl border border-border bg-background px-4 text-sm font-semibold">Limpar</button>
          </SheetClose>
          <button type="button" onClick={onApply} disabled={!customDatesValid} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-45">
            <CheckCircle2 className="size-4" /> Aplicar
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FinanceError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-semibold">Financeiro indisponível</p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </div>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold">
          <RefreshCw className="size-3.5" /> Tentar novamente
        </button>
      )}
    </section>
  );
}

function paymentMethodLabel(value: string) {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? "Outro";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
