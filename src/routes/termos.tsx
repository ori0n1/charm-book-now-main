import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import { LegalPageLayout, LegalSection } from "@/components/public/legal-page-layout";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: `Termos e Condições — ${APP_BRAND.name}` },
      { name: "description", content: "Termos e condições de utilização da plataforma Bellza." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPageLayout
      title="Termos e Condições"
      updatedAt="1 de junho de 2026"
      description="Regras principais para utilização da Bellza por estúdios, profissionais e clientes finais."
    >
      <LegalSection title="1. Identificação">
        <p>
          A {APP_BRAND.name} é operada por {APP_BRAND.legalName}, NIF {APP_BRAND.taxId}, com contacto oficial
          em{" "}
          <a className="underline underline-offset-2" href={`mailto:${APP_BRAND.supportEmail}`}>
            {APP_BRAND.supportEmail}
          </a>
          .
        </p>
      </LegalSection>
      <LegalSection title="2. Serviço">
        <p>
          A Bellza disponibiliza software de gestão para agenda, equipa, clientes, pagamentos, comunicações e
          página pública de marcações. O estúdio é responsável por configurar serviços, preços, disponibilidade
          e políticas apresentadas aos seus clientes.
        </p>
      </LegalSection>
      <LegalSection title="3. Subscrição">
        <p>
          Os planos pagos podem ser mensais, trimestrais ou anuais. O acesso pode incluir um período de teste
          gratuito de 14 dias. A subscrição pode ser cancelada de forma simples, sem fidelização.
        </p>
      </LegalSection>
      <LegalSection title="4. Pagamentos, cancelamentos e reembolsos">
        <p>
          Pagamentos online e sinais podem ser processados por fornecedores certificados. Regras de
          cancelamento e reembolso devem ser claras para o cliente antes da confirmação. Consulte a{" "}
          <Link to="/politica-reembolso" className="underline underline-offset-2">
            Política de Reembolso
          </Link>{" "}
          e a{" "}
          <Link to="/politica-cancelamento" className="underline underline-offset-2">
            Política de Cancelamento
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="5. Privacidade">
        <p>
          O tratamento de dados pessoais está descrito na{" "}
          <Link to="/privacidade" className="underline underline-offset-2">
            Política de Privacidade
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
