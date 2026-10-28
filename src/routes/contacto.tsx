import { createFileRoute } from "@tanstack/react-router";
import { Mail, ShieldCheck } from "lucide-react";
import { APP_BRAND } from "@/lib/app-brand";
import { LegalPageLayout, LegalSection } from "@/components/public/legal-page-layout";

export const Route = createFileRoute("/contacto")({
  head: () => ({
    meta: [
      { title: `Contacto — ${APP_BRAND.name}` },
      {
        name: "description",
        content: "Contacto oficial da Bellza para suporte, questões comerciais, RGPD e pagamentos.",
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <LegalPageLayout
      title="Contacto"
      updatedAt="1 de junho de 2026"
      description="Canal oficial para suporte, questões sobre subscrição, privacidade e pagamentos."
    >
      <div className="public-card p-5">
        <div className="flex items-start gap-3">
          <Mail className="mt-1 size-5 text-accent" />
          <div>
            <p className="text-sm font-semibold">Email oficial</p>
            <a className="mt-1 inline-block underline underline-offset-2" href={`mailto:${APP_BRAND.supportEmail}`}>
              {APP_BRAND.supportEmail}
            </a>
          </div>
        </div>
      </div>

      <LegalSection title="Responsável">
        <p>
          {APP_BRAND.legalName}
          <br />
          NIF {APP_BRAND.taxId}
          <br />
          Portugal
        </p>
      </LegalSection>

      <LegalSection title="Temas de contacto">
        <ul>
          <li>Suporte técnico e acesso à conta Bellza.</li>
          <li>Questões sobre planos, faturação, cancelamento ou reembolso.</li>
          <li>Pedidos relacionados com privacidade, cookies e direitos RGPD.</li>
          <li>Dúvidas sobre pagamentos online e checkout.</li>
        </ul>
      </LegalSection>

      <div className="public-card flex items-start gap-3 p-5">
        <ShieldCheck className="mt-0.5 size-5 text-accent" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          A Bellza mantém este contacto acessível para garantir transparência comercial, suporte ao cliente e
          conformidade com requisitos legais europeus.
        </p>
      </div>
    </LegalPageLayout>
  );
}
