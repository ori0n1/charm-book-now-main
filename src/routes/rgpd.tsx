import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import { LegalPageLayout, LegalSection } from "@/components/public/legal-page-layout";

export const Route = createFileRoute("/rgpd")({
  head: () => ({
    meta: [
      { title: `RGPD/GDPR — ${APP_BRAND.name}` },
      { name: "description", content: "Informação RGPD/GDPR da Bellza para utilizadores em Portugal e União Europeia." },
    ],
  }),
  component: GdprPage,
});

function GdprPage() {
  return (
    <LegalPageLayout
      title="RGPD/GDPR"
      updatedAt="1 de junho de 2026"
      description="Resumo das medidas e direitos relacionados com proteção de dados pessoais."
    >
      <LegalSection title="Compromisso">
        <p>
          A {APP_BRAND.name} foi estruturada para operar com transparência, minimização de dados e informação
          acessível para estúdios, profissionais e clientes finais.
        </p>
      </LegalSection>
      <LegalSection title="Direitos dos titulares">
        <p>
          Os titulares podem solicitar acesso, retificação, apagamento, limitação, portabilidade ou oposição ao
          tratamento dos seus dados através de {APP_BRAND.supportEmail}.
        </p>
      </LegalSection>
      <LegalSection title="Medidas de proteção">
        <ul>
          <li>Autenticação e sessões seguras.</li>
          <li>Consentimento e informação legal no fluxo de marcação.</li>
          <li>Dados operacionais limitados ao necessário para prestar o serviço.</li>
          <li>Políticas públicas de privacidade, cookies, termos, reembolso e cancelamento.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Informação completa">
        <p>
          Consulte a{" "}
          <Link to="/privacidade" className="underline underline-offset-2">
            Política de Privacidade
          </Link>{" "}
          e a{" "}
          <Link to="/cookies" className="underline underline-offset-2">
            Política de Cookies
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
