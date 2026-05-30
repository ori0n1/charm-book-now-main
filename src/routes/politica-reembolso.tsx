import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createFileRoute("/politica-reembolso")({
  head: () => ({
    meta: [
      { title: "Política de Reembolso" },
      {
        name: "description",
        content: "Como são tratados pedidos de reembolso de sinais pagos online.",
      },
    ],
  }),
  component: RefundPolicyPage,
});

function RefundPolicyPage() {
  return (
    <LegalShell title="Política de Reembolso">
      <Section title="Pedido de reembolso">
        Se o estúdio permitir pedidos de reembolso, pode enviar o motivo através da página da
        reserva. O pedido fica registado para análise.
      </Section>
      <Section title="Decisão do estúdio">
        A resposta depende da regra aceite no checkout, do prazo de cancelamento e do contexto da
        marcação. O estúdio pode aprovar, recusar ou propor uma remarcação.
      </Section>
      <Section title="Sinal pago online">
        O sinal é um valor antecipado. Quando a marcação acontece, é descontado no preço final do
        serviço.
      </Section>
      <Section title="Como o reembolso é feito">
        Quando o pedido é aprovado, o estúdio indica o próximo passo. Em alguns casos o reembolso
        pode ser manual, dependendo do método de pagamento usado.
      </Section>
    </LegalShell>
  );
}

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-5 py-10 md:py-16">
      <main className="mx-auto max-w-2xl">
        <Link to="/" className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground hover:underline">
          Voltar
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">Última atualização: 29 de maio de 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">{children}</div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mt-2">{children}</p>
    </section>
  );
}
