import { APP_BRAND } from "@/lib/app-brand";

export const PRICING_PLANS = [
  {
    id: "monthly",
    name: "Premium Mensal",
    price: "8,99 €",
    cadence: "/mês",
    total: "Cancele quando quiser",
    equivalent: "Teste gratuito de 14 dias incluído",
    badges: ["Sem fidelização", "Tudo ilimitado"],
    highlighted: false,
  },
  {
    id: "yearly",
    name: "Premium Anual",
    price: "71,99 €",
    cadence: "/ano",
    total: "Equivale a 6,00 €/mês",
    equivalent: "Poupe 33% face ao mensal",
    badges: ["Recomendado", "Melhor custo-benefício"],
    highlighted: true,
  },
] as const;

export const PLAN_FEATURES = [
  "Aplicativo próprio do estúdio em formato PWA",
  "Página pública própria com link exclusivo",
  "Profissionais, clientes e serviços ilimitados",
  "Agenda online, disponibilidade e reservas ilimitadas",
  "Mensagens automáticas e notificações ilimitadas",
  "Pagamentos online, sinais, caixa e relatórios",
  "Programa de indicação com crédito mensal",
  "Suporte, atualizações contínuas e 14 dias grátis",
] as const;

export const TRUST_PILLARS = [
  { value: "PWA", label: "Aplicativo próprio para cada estúdio" },
  { value: "Ilimitado", label: "Equipa, clientes, serviços e avisos" },
  { value: "14 dias", label: "Teste Premium gratuito" },
  { value: "Sem loja", label: "Instalável no iPhone e Android" },
] as const;

export const DIFFERENTIATORS = [
  {
    title: "Não é marketplace",
    description:
      "O cliente entra diretamente no ambiente do seu estúdio, sem ver concorrentes, anúncios ou outros negócios a disputar a atenção.",
  },
  {
    title: "Aplicativo próprio",
    description:
      "A página pública pode ser guardada no telemóvel como app, com nome, identidade e experiência focados na sua marca.",
  },
  {
    title: "Marca independente",
    description:
      "Cada estúdio tem link próprio, página própria, agenda própria e comunicação própria dentro da infraestrutura Bellza.",
  },
] as const;

export const FEATURE_BLOCKS = [
  {
    title: "Presença digital do estúdio",
    description:
      "Crie uma página exclusiva para reservas e transforme essa experiência num aplicativo próprio para clientes recorrentes.",
    points: ["Link próprio", "Página pública", "PWA instalável"],
  },
  {
    title: "Agenda online completa",
    description:
      "Organize profissionais, serviços, horários, folgas e disponibilidade real sem obrigar a equipa a confirmar tudo manualmente.",
    points: ["Reservas online", "Disponibilidade real", "Sem conflitos"],
  },
  {
    title: "Recursos ilimitados",
    description:
      "A Bellza não cobra por quantidade de profissionais, clientes, serviços, mensagens ou notificações usadas no dia a dia.",
    points: ["Equipa ilimitada", "Clientes ilimitados", "Avisos ilimitados"],
  },
  {
    title: "Gestão financeira",
    description:
      "Acompanhe sinais, pagamentos online, caixa, comissões e indicadores importantes num painel pensado para leitura rápida.",
    points: ["Sinais online", "Caixa", "Relatórios"],
  },
  {
    title: "Comunicação automática",
    description:
      "Confirmações, lembretes, alterações e cancelamentos chegam pelos canais configurados, com logs separados por envio.",
    points: ["WhatsApp", "E-mail", "Push/PWA"],
  },
  {
    title: "Operação independente",
    description:
      "A Bellza liga vários estúdios numa plataforma robusta, mas cada negócio continua com a sua identidade e os seus clientes.",
    points: ["Sem concorrência na página", "Dados do estúdio", "Experiência premium"],
  },
] as const;

export const MODULES = [
  "Aplicativo PWA",
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
      "Não. Os planos incluem profissionais, clientes, serviços, mensagens automáticas e notificações ilimitadas para o uso normal do estúdio.",
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
  name: "Estúdio Demo",
  slug: "estudio-demo",
  domain: "bellza.pt/estudio-demo",
} as const;

export const PREVIEW_AGENDA = [
  { time: "09:00", service: "Design de sobrancelhas", client: "Cliente A.", professional: "Profissional 1", status: "Confirmada" },
  { time: "10:30", service: "Manicure gel", client: "Cliente B.", professional: "Profissional 2", status: "Pago online" },
  { time: "14:00", service: "Corte + barba", client: "Cliente C.", professional: "Profissional 3", status: "Lembrete enviado" },
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
