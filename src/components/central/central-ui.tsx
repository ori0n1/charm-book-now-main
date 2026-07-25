/* eslint-disable react-refresh/only-export-components */
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  Database,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("pt-PT", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatDateTime(value: string | null, timezone = "Europe/Lisbon") {
  if (!value) return "Sem acesso";
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function CentralShell({
  children,
  updatedAt,
  actions,
}: {
  children: React.ReactNode;
  updatedAt?: string | null;
  actions?: React.ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const metricsActive = pathname === "/admin/central-metricas";
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center gap-3 px-3 py-3 sm:px-5 lg:px-8">
          <Link
            to="/admin"
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition hover:text-foreground"
            aria-label="Voltar ao painel"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Administração Bellza
            </p>
            <p className="truncate text-base font-semibold tracking-tight">Central da plataforma</p>
          </div>
          {updatedAt && (
            <p className="hidden text-[11px] text-muted-foreground xl:block">
              Dados atualizados {formatDateTime(updatedAt)}
            </p>
          )}
          {actions}
          <nav className="order-last grid w-full grid-cols-2 rounded-xl bg-muted/60 p-1 sm:order-none sm:w-auto">
            <Link
              to="/admin/central"
              className={cn(
                "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition",
                !metricsActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Building2 className="h-3.5 w-3.5" />
              Central
            </Link>
            <Link
              to="/admin/central-metricas"
              search={{ studio: undefined }}
              className={cn(
                "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition",
                metricsActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Métricas
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[92rem] px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

const ACCENTS = {
  neutral: "bg-muted text-muted-foreground",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  red: "bg-red-500/10 text-red-700 dark:text-red-300",
} as const;

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon = Database,
  accent = "neutral",
  money = false,
  loading = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: keyof typeof ACCENTS;
  money?: boolean;
  loading?: boolean;
}) {
  return (
    <article className="flex min-h-28 min-w-0 flex-col justify-between rounded-2xl border border-border/80 bg-card p-3.5 shadow-sm sm:min-h-32 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", ACCENTS[accent])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      {loading ? (
        <div className="h-7 w-24 animate-pulse rounded-lg bg-muted" />
      ) : (
        <p
          className={cn(
            "max-w-full text-[clamp(1.35rem,5vw,2rem)] font-semibold leading-none tracking-tight",
            money && "inline-flex flex-nowrap whitespace-nowrap text-[clamp(1rem,4.2vw,1.8rem)]",
          )}
        >
          {value}
        </p>
      )}
      {hint && <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>}
    </article>
  );
}

export function Panel({
  title,
  description,
  children,
  className,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-border/80 bg-card shadow-sm", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatusBadge({
  value,
  kind = "neutral",
}: {
  value: string;
  kind?: "neutral" | "success" | "warning" | "danger";
}) {
  const colors = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    danger: "bg-red-500/10 text-red-700 dark:text-red-300",
  };
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold",
        colors[kind],
      )}
    >
      {value}
    </span>
  );
}

export function EmptyState({ text = "Sem dados para o período selecionado." }: { text?: string }) {
  return (
    <div className="grid h-56 place-items-center px-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

export const chartTooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 11,
  boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
};
