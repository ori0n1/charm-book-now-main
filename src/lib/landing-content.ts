import { APP_BRAND } from "@/lib/app-brand";

export const PRICING_PLANS = [
  {
    id: "monthly",
    name: "Premium Mensal",
    price: "8,99 €",
    cadence: "/mês",
    total: "Cobrado mensalmente",
    equivalent: "Flexível para começar",
    badges: ["Sem fidelização"],
    highlighted: false,
  },
  {
    id: "quarterly",
    name: "Premium Trimestral",
    price: "22,49 €",
    cadence: "total",
    total: "Equivale a 7,50 €/mês",
    equivalent: "10% de desconto",
    badges: ["Mais popular"],
    highlighted: false,
  },
  {
    id: "yearly",
    name: "Premium Anual",
    price: "71,99 €",
    cadence: "total",
    total: "Equivale a 6,00 €/mês",
    equivalent: "Melhor valor para equipas estáveis",
    badges: ["Melhor valor", "Poupe 33%"],
    highlighted: true,
  },
] as const;

export const PLAN_FEATURES = [
  "14 dias grátis com acesso completo",
  "Agenda, clientes e equipa sem taxas por profissional",
  "Página pública de marcações com a marca do estúdio",
  "Pagamentos online e sinais através de Stripe",
  "WhatsApp automático para confirmações e lembretes",
  "Gestão financeira, comissões e visão do balcão",
  "PWA para usar no telemóvel, tablet e computador",
  "Suporte premium por email",
] as const;

export const LANDING_FAQS = [
  {
    question: "Como funciona o teste gratuito de 14 dias?",
    answer:
      "Pode experimentar a Bellza durante 14 dias com acesso às principais funcionalidades. No fim do período de teste escolhe o plano que melhor se adapta ao seu estúdio.",
  },
  {
    question: "Preciso de fidelização?",
    answer:
      "Não. A Bellza foi desenhada para ser simples de começar e simples de cancelar. Pode gerir a subscrição sem contratos longos.",
  },
  {
    question: "A Bellza está preparada para pagamentos Stripe?",
    answer:
      "Sim. A plataforma suporta sinais e pagamentos online através de Stripe, com políticas claras de cancelamento e reembolso apresentadas no fluxo de reserva.",
  },
  {
    question: "Funciona para barbearias e equipas com vários profissionais?",
    answer:
      "Sim. Pode organizar serviços, horários, equipa, permissões, agenda por profissional e página pública para receber marcações online.",
  },
  {
    question: "A plataforma cumpre o RGPD?",
    answer:
      "A Bellza inclui páginas legais, consentimento no fluxo de marcação, gestão de dados essenciais e informação clara sobre privacidade, cookies e contacto.",
  },
] as const;

export const TRUST_PILLARS = [
  { value: "14 dias", label: "Teste gratuito" },
  { value: "Stripe", label: "Pagamentos online" },
  { value: "RGPD", label: "Pronto para Portugal e UE" },
  { value: "PWA", label: "Telemóvel, tablet e desktop" },
] as const;

export const FEATURE_BLOCKS = [
  {
    title: "Gestão de agendamentos",
    description:
      "Agenda por profissional, bloqueios, horários, serviços e estados de reserva numa vista clara para o dia a dia.",
    points: ["Calendário por equipa", "Reservas 24/7", "Bloqueios e disponibilidade"],
  },
  {
    title: "WhatsApp automático",
    description:
      "Confirmações, lembretes e links de gestão enviados com contexto, para reduzir faltas e mensagens manuais.",
    points: ["Lembretes operacionais", "Links de reserva", "Menos trabalho repetitivo"],
  },
  {
    title: "Pagamentos online",
    description:
      "Cobrança de sinais, regras de cancelamento e comunicação transparente antes da confirmação.",
    points: ["Stripe", "Sinais por serviço", "Políticas visíveis no checkout"],
  },
  {
    title: "Gestão financeira",
    description:
      "Resumo de receitas, sinais, vendas no balcão e comissões para perceber a saúde do negócio sem folhas soltas.",
    points: ["Receitas por período", "Comissões", "Histórico financeiro"],
  },
  {
    title: "Gestão da equipa",
    description:
      "Convites, permissões e funções para manter o painel organizado entre administradores e profissionais.",
    points: ["Perfis de equipa", "Acesso limitado", "Operação no balcão"],
  },
  {
    title: "Página pública do estúdio",
    description:
      "Uma página de marcações elegante, mobile-first e pronta para partilhar no Instagram, WhatsApp ou Google.",
    points: ["Link próprio", "Serviços e preços", "Experiência mobile"],
  },
] as const;

export const SECURITY_POINTS = [
  "Consentimento e informação clara no fluxo de marcação",
  "Política de privacidade, cookies, termos, cancelamento e reembolso",
  "Contacto oficial acessível para suporte e pedidos de dados",
  "Sessões seguras e autenticação integrada",
] as const;

export const TESTIMONIALS = [
  {
    quote:
      "A Bellza dá ao estúdio uma imagem mais organizada: agenda limpa, reservas online e menos mensagens espalhadas ao longo do dia.",
    author: "Gestora de estúdio",
    context: "Estética e unhas, Portugal",
  },
  {
    quote:
      "O ponto forte é sentir que tudo está no mesmo sítio: equipa, clientes, sinais e comunicação com o cliente.",
    author: "Responsável de barbearia",
    context: "Equipa com vários profissionais",
  },
] as const;

export const PREVIEW_STUDIO = {
  name: "Studio Lumina",
  slug: "studio-lumina",
} as const;

export const PREVIEW_AGENDA = [
  {
    time: "09:00 - 10:00",
    service: "Design de sobrancelhas",
    client: "Sofia Almeida",
    professional: "Mariana Costa",
    status: "Confirmado",
    tone: "emerald" as const,
  },
  {
    time: "10:30 - 12:00",
    service: "Manicure gel + manutenção",
    client: "Juliana Ferreira",
    professional: "Rita Mendes",
    status: "Sinal recebido",
    tone: "accent" as const,
  },
  {
    time: "14:30 - 15:30",
    service: "Limpeza de pele",
    client: "Inês Ribeiro",
    professional: "Mariana Costa",
    status: "Aguarda confirmação",
    tone: "amber" as const,
  },
] as const;

export const PREVIEW_CLIENTS = [
  {
    name: "Sofia Almeida",
    visits: "12 visitas",
    note: "Prefere horários de manhã e produtos sem fragrância intensa.",
  },
  {
    name: "Juliana Ferreira",
    visits: "7 visitas",
    note: "Cliente regular de manicure gel. Próxima manutenção sugerida em 3 semanas.",
  },
] as const;

export const PREVIEW_FINANCE = [
  { label: "Receita confirmada", value: "2.840 €", hint: "Este mês" },
  { label: "Sinais digitais", value: "420 €", hint: "Confirmados online" },
  { label: "No balcão", value: "1.180 €", hint: "Presencial" },
] as const;

export function exampleBookingUrl(slug = PREVIEW_STUDIO.slug) {
  return `${APP_BRAND.publicSiteHost}/s/${slug}`;
}
