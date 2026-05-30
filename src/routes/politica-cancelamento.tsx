import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createFileRoute("/politica-cancelamento")({
  head: () => ({
    meta: [
      { title: "Política de Cancelamento" },
      {
        name: "description",
        content: "Regras de cancelamento, remarcação e sinal nas reservas online.",
      },
    ],
  }),
  component: CancellationPolicyPage,
});

function CancellationPolicyPage() {
  return (
    <LegalShell title="Política de Cancelamento">
      <Section title="Antes de marcar">
        Cada estúdio define o prazo para cancelar ou remarcar. Essa informação aparece no checkout,
        antes da confirmação da reserva.
      </Section>
      <Section title="Sinal">
        Quando existe sinal, o valor serve para guardar o horário escolhido. No dia do atendimento,
        esse valor é descontado no total a pagar ao estúdio.
      </Section>
      <Section title="Cancelamentos">
        Dentro do prazo indicado, pode cancelar ou pedir remarcação. Depois desse prazo, a decisão
        fica a cargo do estúdio, porque o horário já estava reservado para si.
      </Section>
      <Section title="Registo da aceitação">
        Ao confirmar a reserva, guardamos a versão das regras apresentada no checkout. Isto protege a
        cliente e o estúdio caso seja preciso consultar a marcação mais tarde.
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
