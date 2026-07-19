import { APP_BRAND } from "@/lib/app-brand";

export const PRICING_PLANS = [
  {
    id: "monthly",
    name: "Premium Mensal",
    price: "8,99 €",
    cadence: "/mês",
    total: "Cancele quando quiser",
    equivalent: "Teste gratuito de 14 dias incluído",
    badges: ["Sem fidelização", "Preço de lançamento"],
    highlighted: false,
  },
  {
    id: "yearly",
    name: "Premium Anual",
    price: "89,99 €",
    cadence: "/ano",
    total: "Equivale a 7,50 €/mês",
    equivalent: "Poupe cerca de 17% face ao mensal",
    badges: ["Recomendado", "Condições de lançamento"],
    highlighted: true,
  },
] as const;

export const PLAN_FEATURES = [
  "Aplicativo próprio do estúdio em formato PWA",
  "Página pública própria com link exclusivo",
  "Múltiplos profissionais, clientes e serviços",
  "Agenda online, disponibilidade e reservas",
  "Mensagens automáticas e notificações",
  "Pagamentos online, sinais, caixa e relatórios",
  "Programa de indicação com crédito mensal",
  "Suporte, atualizações contínuas e 14 dias grátis",
] as const;

export const TRUST_PILLARS = [
  { value: "14 dias", label: "Teste Premium gratuito" },
  { value: "PWA", label: "App instalável para o seu estúdio" },
  { value: "1 link", label: "Reservas diretas na sua marca" },
  { value: "Tudo junto", label: "Agenda, equipa, clientes e pagamentos" },
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
    title: "Reservas online",
    description:
      "O cliente escolhe serviço, profissional, data e horário na página pública do seu estúdio.",
    points: ["Disponibilidade real", "Link próprio", "Resumo da reserva"],
  },
  {
    title: "Agenda e equipa",
    description:
      "Organize profissionais, horários, folgas, bloqueios e reservas sem depender de conversas soltas.",
    points: ["Profissionais", "Horários", "Bloqueios"],
  },
  {
    title: "Clientes",
    description:
      "Acompanhe histórico, preferências, presença e contexto de relacionamento num só lugar.",
    points: ["Ficha do cliente", "Histórico", "Preferências"],
  },
  {
    title: "Pagamentos e avisos",
    description:
      "Acompanhe sinais, pagamentos, caixa, lembretes e notificações importantes da operação.",
    points: ["Sinais online", "Caixa", "Notificações"],
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
  "Outro estúdio cria conta através desse link.",
  "Se permanecer assinante por 30 dias, o crédito é aplicado automaticamente.",
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
      "Durante a fase de lançamento, o plano inclui as funcionalidades atuais para gerir profissionais, clientes, serviços, mensagens automáticas e notificações no uso normal do estúdio.",
  },
  {
    question: "Os clientes conseguem marcar online?",
    answer:
      "Sim. O cliente escolhe serviço, profissional, data e horário numa página mobile-first que respeita a disponibilidade real do estúdio.",
  },
  {
    question: "Como funciona o programa de indicação?",
    answer:
      "Cada estúdio tem um link próprio. Quando outro estúdio assina através desse link e permanece ativo por pelo menos 30 dias, quem indicou recebe crédito equivalente ao valor mensal do plano.",
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
