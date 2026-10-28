/** Identidade global Bellza, usada na landing, autenticação, páginas legais e painel. */
export const APP_BRAND = {
  name: "Bellza",
  shortName: "Bellza",
  description:
    "Plataforma premium para salões, estúdios de estética e barbearias criarem a sua própria página, o seu próprio aplicativo PWA, agenda online, reservas, pagamentos, clientes e notificações automáticas.",
  tagline: "Aplicativo próprio e gestão premium para negócios de beleza.",
  supportEmail: "info@bellza.pt",
  legalName: "Silas Oliveira Silva",
  taxId: "326825487",
  publicSiteHost: "bellza.pt",
} as const;

export const CANONICAL_ORIGIN = `https://${APP_BRAND.publicSiteHost}`;

export const LANDING_SEO = {
  title: "Bellza | Agenda online gratuita para salões e estúdios",
  description:
    "Gestão simples e profissional para salões, estúdios e barbearias: agenda online, clientes, equipa, pagamentos e comunicação num só lugar.",
  keywords:
    "agenda online gratuita, software para salão, sistema para salão de beleza, agenda para estúdio de estética, software para barbearia, reservas online, gestão para estúdios, pagamentos para salão, aplicação para agendamento, Bellza",
  themeColor: "#FFFDFA",
  locale: "pt_PT",
  url: `${CANONICAL_ORIGIN}/`,
} as const;
