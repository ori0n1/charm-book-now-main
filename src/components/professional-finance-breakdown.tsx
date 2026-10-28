import { formatEUR } from "@/lib/utils";
import type { ProfessionalFinanceSummary } from "@/lib/professional-finance-summary";

function methodLabel(method: string) {
  if (method === "cash" || method === "dinheiro") return "Dinheiro";
  if (method === "card" || method === "cartao" || method === "cartão") return "Cartão";
  if (method === "mb_way" || method === "mbway") return "MB WAY";
  return "Outro método registado";
}

export function ProfessionalFinanceBreakdown({
  summary,
  currentPercent,
  paymentPolicy,
}: {
  summary: ProfessionalFinanceSummary;
  currentPercent: number;
  paymentPolicy: string;
}) {
  const showOnline = paymentPolicy !== "pay_in_studio" || summary.receivedOnlineCents > 0;
  const historical = summary.appliedPercents.map((percent) => `${percent}%`).join(" · ");
  return (
    <div className="space-y-2 rounded-2xl border border-border/75 bg-background/65 p-3 sm:p-3.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Recebimentos dos clientes
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Valores pagos pelos clientes pelos serviços concluídos. Não representam repasses à profissional.
          </p>
        </div>
        <strong className="text-base font-semibold text-foreground">
          {formatEUR(summary.clientReceivedCents / 100)}
        </strong>
      </div>
      <div className={`grid gap-2 text-xs ${showOnline ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {showOnline && (
          <div className="rounded-xl bg-muted/45 p-2.5">
            <span className="block text-muted-foreground">Recebido online</span>
            <strong className="mt-1 block font-mono text-sm">{formatEUR(summary.receivedOnlineCents / 100)}</strong>
          </div>
        )}
        <div className="rounded-xl bg-muted/45 p-2.5">
          <span className="block text-muted-foreground">Recebido presencialmente</span>
          <strong className="mt-1 block font-mono text-sm">{formatEUR(summary.receivedOnsiteCents / 100)}</strong>
        </div>
        <div className="rounded-xl bg-muted/45 p-2.5">
          <span className="block text-muted-foreground">Pendente ou sem recebimento registado</span>
          <strong className="mt-1 block font-mono text-sm">{formatEUR(summary.clientPendingCents / 100)}</strong>
        </div>
      </div>
      {summary.onsiteMethods.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Métodos presenciais registados: {summary.onsiteMethods.map(({ method, cents }) =>
            `${methodLabel(method)} ${formatEUR(cents / 100)}`,
          ).join(" · ")}
        </p>
      )}
      {showOnline && summary.receivedOnlineCents > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          O sinal online já integra o valor total do serviço; não é somado novamente à faturação.
        </p>
      )}
      <p className="border-t border-border/70 pt-2 text-xs leading-relaxed text-muted-foreground">
        Percentagem atual da profissional: {currentPercent}%.
        {historical && ` Percentagens guardadas nas reservas concluídas: ${historical}.`}
        {summary.appliedPercents.some((percent) => percent !== currentPercent) &&
          " As reservas anteriores mantêm a regra registada na sua criação."}
      </p>
    </div>
  );
}
