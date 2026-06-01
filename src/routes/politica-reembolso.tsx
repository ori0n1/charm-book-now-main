import { createFileRoute } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import { LegalPageLayout, LegalSection } from "@/components/public/legal-page-layout";

export const Route = createFileRoute("/politica-reembolso")({
  head: () => ({
    meta: [
      { title: `Política de Reembolso — ${APP_BRAND.name}` },
      { name: "description", content: "Como são tratados pedidos de reembolso na Bellza." },
    ],
  }),
  component: RefundPolicyPage,
});

function RefundPolicyPage() {
  return (
    <LegalPageLayout
      title="Política de Reembolso"
      updatedAt="1 de junho de 2026"
      description="Transparência sobre reembolsos de subscrição e sinais pagos online."
    >
      <LegalSection title="Subscrição Bellza">
        <p>
          Se existir cobrança indevida, erro técnico ou duplicação de pagamento, contacte {APP_BRAND.supportEmail}
          para análise. Pedidos são avaliados caso a caso, de forma razoável e documentada.
        </p>
      </LegalSection>
      <LegalSection title="Sinais pagos a estúdios">
        <p>
          Quando um cliente paga um sinal para reservar um serviço, o valor fica associado à marcação. A decisão
          de reembolso depende das regras do estúdio apresentadas no checkout e da política de cancelamento
          aplicável.
        </p>
      </LegalSection>
      <LegalSection title="Prazos e método">
        <p>
          Quando aprovado, o reembolso é processado através do método de pagamento original ou por instruções
          indicadas pelo estúdio, conforme o fornecedor de pagamentos utilizado.
        </p>
      </LegalSection>
      <LegalSection title="Contacto">
        <p>
          Para pedidos relacionados com a plataforma Bellza, envie email para{" "}
          <a className="underline underline-offset-2" href={`mailto:${APP_BRAND.supportEmail}`}>
            {APP_BRAND.supportEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
