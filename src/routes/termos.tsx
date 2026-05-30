import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Utilização" },
      {
        name: "description",
        content: "Termos de utilização da plataforma de marcações e gestão de estúdios.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background px-5 py-10 md:py-16">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground hover:underline">
          ← Voltar
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">Termos de Utilização</h1>
        <p className="mt-2 text-xs text-muted-foreground">Última atualização: 27 de maio de 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
          <Section title="1. Âmbito">
            Estes termos regulam a utilização da plataforma por estúdios, profissionais e clientes
            finais que realizam marcações públicas.
          </Section>
          <Section title="2. Conta do estúdio">
            A dona do estúdio é responsável por manter dados corretos, proteger o acesso à conta e
            garantir que apenas pessoas autorizadas acedem ao painel.
          </Section>
          <Section title="3. Marcações e pagamentos">
            O estúdio define serviços, preços, sinais, políticas de pagamento e cancelamento. O
            cliente deve confirmar os dados antes de concluir a reserva ou pagamento.
          </Section>
          <Section title="4. Comunicações">
            Mensagens de confirmação e lembretes são comunicações operacionais ligadas à marcação.
            Comunicações promocionais exigem consentimento próprio.
          </Section>
          <Section title="5. Uso aceitável">
            Não é permitido tentar aceder a dados de outros estúdios, abusar de formulários públicos,
            contornar pagamentos, interferir com a segurança ou publicar conteúdo ilegal.
          </Section>
          <Section title="6. Privacidade">
            O tratamento de dados pessoais é descrito na{" "}
            <Link to="/privacidade" className="underline">
              Política de Privacidade
            </Link>
            .
          </Section>
        </div>
      </div>
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
