import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import { LegalPageLayout, LegalSection } from "@/components/public/legal-page-layout";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: `Política de Privacidade — ${APP_BRAND.name}` },
      {
        name: "description",
        content: "Como a Bellza trata dados pessoais de estúdios, profissionais e clientes em Portugal.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Política de Privacidade"
      updatedAt="1 de junho de 2026"
      description="Informação sobre recolha, utilização, conservação e direitos dos titulares de dados."
    >
      <LegalSection title="Responsável pelo tratamento">
        <p>
          A {APP_BRAND.name} é operada por {APP_BRAND.legalName}, NIF {APP_BRAND.taxId}. Para questões de
          privacidade pode contactar{" "}
          <a className="underline underline-offset-2" href={`mailto:${APP_BRAND.supportEmail}`}>
            {APP_BRAND.supportEmail}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Dados tratados">
        <ul>
          <li>Dados de conta do estúdio, incluindo nome, email e dados de autenticação.</li>
          <li>Dados operacionais de clientes, como nome, telefone, email, serviço, data e hora da marcação.</li>
          <li>Informação de pagamentos, sinais, estado da reserva e regras aceites no checkout.</li>
          <li>Dados técnicos necessários para segurança, sessão, prevenção de abuso e funcionamento do serviço.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Finalidades e base legal">
        <p>
          Os dados são tratados para prestar o serviço contratado, gerir reservas, enviar comunicações
          operacionais, processar pagamentos, cumprir obrigações legais e proteger a plataforma. Comunicações
          promocionais exigem consentimento quando aplicável.
        </p>
      </LegalSection>

      <LegalSection title="Subcontratantes e pagamentos">
        <p>
          A Bellza pode recorrer a fornecedores técnicos, incluindo alojamento, autenticação, email,
          comunicações e pagamentos. Pagamentos online podem ser processados por fornecedores
          equivalentes certificados.
        </p>
      </LegalSection>

      <LegalSection title="Direitos RGPD">
        <p>
          Pode solicitar acesso, retificação, apagamento, oposição, limitação ou portabilidade dos seus dados.
          Também pode apresentar reclamação junto da CNPD em{" "}
          <a className="underline underline-offset-2" href="https://www.cnpd.pt" target="_blank" rel="noreferrer">
            www.cnpd.pt
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          Consulte a{" "}
          <Link to="/cookies" className="underline underline-offset-2">
            Política de Cookies
          </Link>{" "}
          para saber como gerir preferências no browser.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
