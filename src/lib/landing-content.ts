import { APP_BRAND } from "@/lib/app-brand";

export const PRICING_PLANS = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: "0 €",
    yearlyPrice: "0 €",
    monthlyPlanId: null,
    yearlyPlanId: null,
    positioning: "Começar",
    annualSaving: null,
    tagline: "Receba reservas online no seu próprio link.",
    features: [
      "Agenda e reservas online",
      "Página pública do seu estúdio",
      "Serviços, clientes e 1 profissional",
    ],
    cta: "Começar grátis",
    highlighted: false,
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: "12,99 €",
    yearlyPrice: "129 €",
    monthlyPlanId: "pro_monthly",
    yearlyPlanId: "pro_yearly",
    positioning: "Gerir",
    annualSaving: "Poupe 26,88 € por ano",
    tagline: "Tenha equipa, clientes e pagamentos sob controlo.",
    features: [
      "Equipa e agendas até 3 profissionais",
      "Pagamentos, sinais e notificações",
      "Clientes, presença e relatórios",
    ],
    cta: "Escolher Pro",
    highlighted: true,
  },
  {
    id: "premium",
    name: "Premium",
    monthlyPrice: "24,99 €",
    yearlyPrice: "249 €",
    monthlyPlanId: "premium_monthly",
    yearlyPlanId: "premium_yearly",
    positioning: "Crescer",
    annualSaving: "Poupe 50,88 € por ano",
    tagline: "Automatize lembretes e trabalhe a fidelização.",
    features: [
      "Agendas e profissionais ativos sem limite",
      "Reservas online na página pública do estúdio",
      "WhatsApp com franquia; lembretes e notificações",
      "Pagamentos, sinais e financeiro avançado",
      "Clientes, fidelidade, promoções e campanhas",
      "Relatórios e gestão avançada da equipa",
    ],
    cta: "Escolher Premium",
    highlighted: false,
  },
] as const;

export const PLAN_COMPARISON = [
  { feature: "Agenda e marcações manuais", free: "Incluído", pro: "Incluído", premium: "Incluído" },
  { feature: "Agendamento online e página pública", free: "Incluído", pro: "Incluído", premium: "Incluído" },
  { feature: "Profissionais ativos", free: "1", pro: "Até 3", premium: "Sem limite" },
  { feature: "Gestão completa de clientes e equipa", free: "—", pro: "Incluído", premium: "Incluído" },
  { feature: "Pagamentos e sinal online", free: "—", pro: "Incluído", premium: "Incluído" },
  { feature: "Notificações e relatórios básicos", free: "—", pro: "Incluído", premium: "Incluído" },
  { feature: "Presença, faltas e avaliações", free: "—", pro: "Incluído", premium: "Incluído" },
  { feature: "WhatsApp e automações", free: "—", pro: "—", premium: "Incluído*" },
  { feature: "Fidelidade, promoções e campanhas", free: "—", pro: "—", premium: "Incluído" },
  { feature: "Financeiro, equipa e relatórios avançados", free: "—", pro: "—", premium: "Incluído" },
] as const;

export const PLAN_FEATURES = [
  "Agenda e marcações manuais",
  "Agendamento online e página pública",
  "Gestão de clientes, serviços e horários",
  "Pagamentos e sinal online a partir do Pro",
  "WhatsApp e automações no Premium",
  "14 dias de Premium gratuitos, sem perda de dados ao terminar",
] as const;

export const TRUST_PILLARS = [
  { value: "Reservas diretas", label: "No link do seu espaço, sem marketplace" },
  { value: "Agenda ligada", label: "Serviços, equipa e horários organizados" },
  { value: "Sinais online", label: "Disponíveis a partir do Pro" },
  { value: "WhatsApp", label: "Lembretes no Premium, sujeitos à franquia" },
] as const;

export const DIFFERENTIATORS = [
  {
    title: "Sem marketplace",
    description:
      "O cliente marca diretamente no ambiente do seu estúdio, sem comparar concorrentes ou ver anúncios.",
  },
  {
    title: "Marca própria",
    description:
      "A página pública, o link e a experiência de reserva mantêm a identidade do seu negócio em primeiro plano.",
  },
  {
    title: "App instalável",
    description:
      "A página pode ser guardada no ecrã inicial do telemóvel como PWA, sem depender de loja de aplicações.",
  },
] as const;

export const FEATURE_BLOCKS = [
  {
    title: "Receba reservas enquanto está a atender",
    description:
      "O cliente escolhe serviço, profissional e horário no link do seu espaço. A marcação entra diretamente na agenda.",
    points: ["Todos os planos", "Disponibilidade real"],
  },
  {
    title: "Dê mais segurança a cada marcação",
    description:
      "Peça sinais online a partir do Pro. No Premium, lembretes por WhatsApp ajudam a evitar esquecimentos, dentro da franquia contratada.",
    points: ["Sinais: Pro e Premium", "WhatsApp: Premium"],
  },
  {
    title: "Saiba o que recebeu",
    description:
      "Acompanhe pagamentos e caixa a partir do Pro. No Premium, consulte o financeiro e os relatórios avançados.",
    points: ["Pagamentos: Pro e Premium", "Avançado: Premium"],
  },
  {
    title: "Dê motivos para voltar",
    description:
      "Consulte o histórico e a presença dos clientes no Pro. No Premium, crie programas de fidelidade e campanhas.",
    points: ["Clientes: todos os planos", "Fidelidade: Premium"],
  },
] as const;

export const MODULES = [
  "App PWA",
  "Página pública",
  "Agenda",
  "Clientes",
  "Profissionais",
  "Serviços",
  "Pagamentos",
  "Notificações",
] as const;

export const REFERRAL_STEPS = [
  "O estúdio recebe um link exclusivo de indicação.",
  "Outro estúdio cria conta pelo link e subscreve Pro ou Premium.",
  "Após 30 dias de assinatura Pro ou Premium ativa, o estúdio que indicou pode receber 14 dias de Premium.",
] as const;

export const SECURITY_POINTS = [
  "Links seguros por reserva e ações auditadas",
  "Políticas de cancelamento, reembolso, privacidade e cookies",
  "Sessões protegidas e autenticação integrada",
  "Dados usados apenas para a operação do estúdio",
] as const;

export const LANDING_FAQS = [
  {
    question: "A Bellza cria uma app própria para o meu estúdio?",
    answer:
      "Sim. Cada estúdio recebe uma página pública própria que pode ser guardada no telemóvel como PWA, funcionando como um aplicativo do próprio estúdio.",
  },
  {
    question: "A Bellza é um marketplace?",
    answer:
      "Não. A Bellza não coloca o cliente a comparar estúdios concorrentes. Cada negócio tem o seu link, a sua página e a sua experiência independente.",
  },
  {
    question: "Tenho limites de profissionais ou clientes?",
    answer:
      "O Free permite 1 profissional e gestão básica de clientes. O Pro permite até 3 profissionais e gestão completa. O Premium inclui recursos avançados de equipa sem limite de profissionais definido. Os dados permanecem guardados quando muda de plano.",
  },
  {
    question: "O que acontece se eu continuar no plano Free?",
    answer:
      "Continua a utilizar agenda, marcações manuais, serviços, horários, clientes básicos e a sua página pública com 1 profissional. Pagamentos online, notificações e recursos avançados ficam indisponíveis, mas os dados já criados não são apagados.",
  },
  {
    question: "O WhatsApp está incluído em que plano?",
    answer:
      "O WhatsApp e as automações estão disponíveis no Premium e sujeitos à franquia e aos limites de utilização contratados. A Bellza apresenta esses limites antes da contratação ou de qualquer cobrança adicional.",
  },
  {
    question: "Os clientes conseguem marcar online?",
    answer:
      "Sim. O cliente escolhe serviço, profissional, data e horário numa página mobile-first que respeita a disponibilidade real do estúdio.",
  },
  {
    question: "Como funciona o programa de indicação?",
    answer:
      "Partilhe o seu link. Se o estúdio indicado mantiver uma assinatura Pro ou Premium ativa durante 30 dias, o seu estúdio pode receber 14 dias de Premium. Até 6 recompensas; quem já paga Premium não recebe dias adicionais.",
  },
  {
    question: "Posso experimentar antes de pagar?",
    answer:
      "Sim. A Bellza inclui 14 dias de teste Premium gratuito para validar a página, o aplicativo, a agenda e o painel antes de escolher um plano.",
  },
] as const;

export const PREVIEW_STUDIO = {
  name: "Studio Bellza",
  slug: "bellza",
  domain: "bellza.pt/s/bellza",
} as const;

export const PREVIEW_AGENDA = [
  { time: "09:00", service: "Design de sobrancelhas", client: "Cliente A.", professional: "Ana", status: "Confirmada" },
  { time: "10:30", service: "Manicure gel", client: "Cliente B.", professional: "Sofia", status: "Pago online" },
  { time: "14:00", service: "Corte + barba", client: "Cliente C.", professional: "Marcello", status: "Lembrete enviado" },
] as const;

export const PREVIEW_CLIENTS = [
  { name: "Cliente A.", visits: "12 visitas", note: "Preferências guardadas de forma anónima para demonstração." },
  { name: "Cliente B.", visits: "5 visitas", note: "Histórico protegido, sem telefones, e-mails ou dados reais." },
] as const;

export const PREVIEW_FINANCE = [
  { label: "Receita confirmada", value: "2.840 €", hint: "Este mês" },
  { label: "Sinais online", value: "420 €", hint: "Pagos antes da visita" },
  { label: "Comissões", value: "680 €", hint: "Equipa" },
] as const;

export function exampleBookingUrl(slug = PREVIEW_STUDIO.slug) {
  return `${APP_BRAND.publicSiteHost}/s/${slug}`;
}
