import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import { LegalPageLayout, LegalSection } from "@/components/public/legal-page-layout";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: `Política de Cookies — ${APP_BRAND.name}` },
      { name: "description", content: "Como a Bellza utiliza cookies essenciais e opcionais." },
    ],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <LegalPageLayout
      title="Política de Cookies"
      updatedAt="1 de junho de 2026"
      description="Explicação simples sobre cookies, preferências e tecnologias necessárias ao funcionamento da Bellza."
    >
      <LegalSection title="O que são cookies">
        <p>
          Cookies são pequenos ficheiros guardados no dispositivo. Ajudam a manter sessões seguras, recordar
          preferências e garantir que a experiência funciona corretamente.
        </p>
      </LegalSection>

      <LegalSection title="Tipos de cookies">
        <ul>
          <li>
            <strong>Essenciais:</strong> necessários para login, segurança, reservas e funcionamento técnico.
          </li>
          <li>
            <strong>Preferências:</strong> guardam opções como tema visual ou decisões no banner.
          </li>
          <li>
            <strong>Analíticos ou marketing:</strong> usados apenas quando forem ativados com consentimento.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Gerir preferências">
        <p>
          Pode aceitar ou recusar cookies não essenciais no banner. Também pode apagar cookies diretamente nas
          definições do seu browser.
        </p>
      </LegalSection>

      <LegalSection title="Mais informação">
        <p>
          Consulte também a{" "}
          <Link to="/privacidade" className="underline underline-offset-2">
            Política de Privacidade
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
