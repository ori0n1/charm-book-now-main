import { createFileRoute } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import { LegalPageLayout, LegalSection } from "@/components/public/legal-page-layout";

export const Route = createFileRoute("/politica-cancelamento")({
  head: () => ({
    meta: [
      { title: `Política de Cancelamento — ${APP_BRAND.name}` },
      { name: "description", content: "Regras de cancelamento e remarcação nas reservas online Bellza." },
    ],
  }),
  component: CancellationPolicyPage,
});

function CancellationPolicyPage() {
  return (
    <LegalPageLayout
      title="Política de Cancelamento"
      updatedAt="1 de junho de 2026"
      description="Regras gerais para cancelamentos, remarcações e sinais em reservas feitas através da Bellza."
    >
      <LegalSection title="Antes de marcar">
        <p>
          Cada estúdio define os seus serviços, preços, prazos de cancelamento e regras de sinal. Essa informação
          deve ser apresentada ao cliente antes da confirmação da reserva.
        </p>
      </LegalSection>
      <LegalSection title="Remarcações">
        <p>
          Dentro do prazo definido pelo estúdio, a reserva pode ser remarcada de acordo com a disponibilidade.
          Fora desse prazo, a decisão cabe ao estúdio.
        </p>
      </LegalSection>
      <LegalSection title="Sinais">
        <p>
          Quando existe sinal, o valor reserva o horário escolhido e pode ser descontado no total do serviço. A
          retenção ou devolução do sinal depende das regras aceites no checkout.
        </p>
      </LegalSection>
      <LegalSection title="Registo das regras">
        <p>
          A Bellza pode guardar a versão das regras apresentada no momento da reserva para consulta futura pelo
          estúdio e pelo cliente.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
