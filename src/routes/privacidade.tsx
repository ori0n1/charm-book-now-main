import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade" },
      {
        name: "description",
        content: "Como os dados são usados para gerir reservas, pagamentos e mensagens do estúdio.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalShell title="Política de Privacidade">
      <Section title="Quem usa os dados">
        <p>
          A plataforma ajuda estúdios e profissionais a gerir reservas. Cada estúdio é responsável
          pelos dados das suas clientes. A plataforma fornece a tecnologia para esse trabalho.
        </p>
      </Section>

      <Section title="Dados que podem ser pedidos">
        <ul>
          <li>Nome, telefone, WhatsApp e email.</li>
          <li>Serviço escolhido, profissional, data, hora, preço e estado da reserva.</li>
          <li>Notas que a cliente decida deixar para preparar o atendimento.</li>
          <li>Dados técnicos necessários para segurança, sessão e prevenção de abuso.</li>
        </ul>
      </Section>

      <Section title="Para que servem">
        <p>
          Usamos estes dados para criar marcações, confirmar pagamentos, enviar mensagens
          operacionais, prestar suporte e manter o serviço seguro. Marketing só deve acontecer com
          consentimento válido.
        </p>
      </Section>

      <Section title="Notas sensíveis">
        <p>
          O campo de observações é opcional. Se incluir alergias, cuidados de saúde ou outra
          informação sensível, essa nota deve ser usada apenas para preparar o atendimento.
        </p>
      </Section>

      <Section title="Pagamentos e mensagens">
        <p>
          Alguns pagamentos podem passar por fornecedores externos, como a Stripe. Mensagens de
          reserva podem ser enviadas por WhatsApp, email ou SMS, conforme a configuração do estúdio.
        </p>
      </Section>

      <Section title="Direitos">
        <p>
          Pode pedir acesso, correção, eliminação ou limitação dos seus dados. Também pode retirar
          consentimento quando o tratamento depender dele. Para reclamações, consulte a CNPD em{" "}
          <a className="underline" href="https://www.cnpd.pt" target="_blank" rel="noreferrer">
            www.cnpd.pt
          </a>
          .
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          A utilização de cookies está explicada na{" "}
          <Link to="/cookies" className="underline">
            Política de Cookies
          </Link>
          .
        </p>
      </Section>
    </LegalShell>
  );
}

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-5 py-10 md:py-16">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground hover:underline">
          Voltar
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">Última atualização: 29 de maio de 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="[&_li]:mt-1 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
      <h2 className="text-base font-medium">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
