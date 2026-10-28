import { Check, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BillingCycle = "monthly" | "yearly";
export type ComparisonTier = "free" | "pro" | "premium";

export type PlanComparisonRow = {
  feature: string;
  free: string;
  pro: string;
  premium: string;
};

const PLAN_LABELS: Record<ComparisonTier, string> = {
  free: "Free",
  pro: "Pro",
  premium: "Premium",
};

export function PlanPeriodToggle({
  value,
  onChange,
  tone = "public",
}: {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  tone?: "public" | "admin";
}) {
  return (
    <div
      className={cn(
        "inline-grid min-h-13 w-full max-w-sm grid-cols-2 rounded-2xl border p-1.5 shadow-sm sm:w-auto",
        tone === "public" ? "border-border bg-card" : "border-border/80 bg-card",
      )}
      role="group"
      aria-label="Periodicidade da assinatura"
    >
      <button
        type="button"
        aria-pressed={value === "monthly"}
        onClick={() => onChange("monthly")}
        className={cn(
          "min-h-11 rounded-xl px-5 text-sm font-semibold transition-[background,color,box-shadow] sm:min-w-28",
          value === "monthly"
            ? "bg-foreground text-background shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Mensal
      </button>
      <button
        type="button"
        aria-pressed={value === "yearly"}
        onClick={() => onChange("yearly")}
        className={cn(
          "flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[background,color,box-shadow] sm:min-w-36 sm:px-5",
          value === "yearly"
            ? "bg-foreground text-background shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Anual
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide",
            value === "yearly" ? "bg-background/15 text-inherit" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
          )}
        >
          −17%
        </span>
      </button>
    </div>
  );
}

export function PlanSummaryCard({
  name,
  positioning,
  tagline,
  price,
  period,
  highlights,
  saving,
  recommended = false,
  current = false,
  action,
  tone = "public",
}: {
  name: string;
  positioning: string;
  tagline: string;
  price: string;
  period: string;
  highlights: readonly string[];
  saving?: string | null;
  recommended?: boolean;
  current?: boolean;
  action: ReactNode;
  tone?: "public" | "admin";
}) {
  const accent = tone === "public" ? "text-accent" : "text-emerald-600 dark:text-emerald-300";
  return (
    <article
      data-plan-card={name.toLowerCase()}
      className={cn(
        "relative flex h-full min-w-0 max-w-full flex-col rounded-[1.35rem] border p-5 shadow-[0_14px_38px_rgba(24,24,27,0.06)] sm:p-6",
        recommended
          ? tone === "public"
            ? "border-accent/55 bg-card ring-2 ring-accent/10"
            : "border-emerald-500/50 bg-card ring-2 ring-emerald-500/10"
          : "border-border/80 bg-card",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[10px] font-bold uppercase tracking-[0.18em]", accent)}>
            {positioning}
          </p>
          <h3 className="mt-1 break-words text-xl font-semibold tracking-tight">{name}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {recommended && (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide",
                tone === "public"
                  ? "bg-accent text-accent-foreground"
                  : "bg-emerald-600 text-white",
              )}
            >
              Mais escolhido
            </span>
          )}
          {current && (
            <span className="rounded-full bg-muted px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
              Plano atual
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex min-w-0 items-baseline gap-1.5">
        <span className="whitespace-nowrap text-[2.15rem] font-light leading-none tracking-[-0.04em] sm:text-4xl">
          {price}
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">/{period}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:min-h-10">{tagline}</p>

      <ul className="mt-4 flex-1 space-y-2.5">
        {highlights.map((highlight) => (
          <li key={highlight} className="flex min-w-0 items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Check className={cn("mt-0.5 size-3.5 shrink-0", accent)} aria-hidden="true" />
            <span className="min-w-0 break-words">{highlight}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5">{action}</div>
      <p className={cn("mt-2 min-h-4 text-center text-[10px] font-semibold", saving ? accent : "text-muted-foreground")}>
        {saving ?? "Sem fidelização"}
      </p>
    </article>
  );
}

export function PlanComparison({
  rows,
  tone = "public",
  className,
}: {
  rows: readonly PlanComparisonRow[];
  tone?: "public" | "admin";
  className?: string;
}) {
  const [mobileTier, setMobileTier] = useState<ComparisonTier>("pro");
  const accent = tone === "public" ? "text-accent" : "text-emerald-700 dark:text-emerald-300";

  return (
    <details data-testid="plan-comparison" className={cn("group min-w-0 border-y border-border/80", className)}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-left marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Comparar todos os recursos</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            Abra apenas quando precisar dos detalhes.
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-200 group-open:rotate-180", accent)} aria-hidden="true" />
      </summary>

      <div className="border-t border-border/70 pb-3 pt-4">
        <div className="hidden md:block" role="table" aria-label="Comparação dos planos Bellza">
          <div className="grid grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,0.75fr))] border-b border-border pb-3 text-center text-xs font-semibold" role="row">
            <div className="px-3 text-left" role="columnheader">Recurso</div>
            <div className="px-2" role="columnheader">Free</div>
            <div className={cn("px-2", accent)} role="columnheader">Pro</div>
            <div className="px-2" role="columnheader">Premium</div>
          </div>
          {rows.map((item) => (
            <div
              key={item.feature}
              className="grid min-w-0 grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,0.75fr))] border-b border-border/60 py-2.5 text-center text-[11px] last:border-0"
              role="row"
            >
              <div className="min-w-0 break-words px-3 text-left font-medium text-foreground" role="rowheader">
                {item.feature}
              </div>
              {([item.free, item.pro, item.premium] as const).map((value, index) => (
                <div
                  key={`${item.feature}-${index}`}
                  className={cn("min-w-0 break-words px-2", value === "—" ? "text-muted-foreground/70" : "font-semibold text-foreground")}
                  role="cell"
                >
                  {value}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="md:hidden">
          <div className="grid grid-cols-3 rounded-xl bg-muted/55 p-1" role="group" aria-label="Plano a comparar">
            {(Object.keys(PLAN_LABELS) as ComparisonTier[]).map((tier) => (
              <button
                key={tier}
                type="button"
                aria-pressed={mobileTier === tier}
                onClick={() => setMobileTier(tier)}
                className={cn(
                  "min-h-9 rounded-lg px-2 text-[11px] font-semibold transition-colors",
                  mobileTier === tier ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {PLAN_LABELS[tier]}
              </button>
            ))}
          </div>
          <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Recursos no {PLAN_LABELS[mobileTier]}
          </p>
          <dl data-testid="mobile-plan-comparison" className="divide-y divide-border/60">
            {rows.map((item) => {
              const value = item[mobileTier];
              return (
                <div key={item.feature} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2.5 text-xs">
                  <dt className="min-w-0 break-words leading-relaxed text-muted-foreground">{item.feature}</dt>
                  <dd className={cn("max-w-24 break-words text-right font-semibold leading-relaxed", value === "—" ? "text-muted-foreground/60" : "text-foreground")}>
                    {value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          * WhatsApp sujeito à franquia e aos limites de utilização contratados. Mudar para um plano inferior nunca apaga os seus dados.
        </p>
      </div>
    </details>
  );
}
