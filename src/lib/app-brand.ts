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
  title: "Bellza | Crie o aplicativo próprio do seu salão ou estúdio",
  description:
    "Crie uma página exclusiva e um aplicativo PWA próprio para salão de beleza, estúdio de estética ou barbearia, com agenda online, reservas, clientes, pagamentos e notificações automáticas.",
  keywords:
    "criar aplicativo para salão de beleza, aplicativo para estúdio de estética, aplicativo para barbearia, software para salão, sistema para salão de beleza, agenda online, reservas online, software para estética, aplicativo para agendamento, gestão para estúdios, aplicativo próprio para salão, sistema completo para beleza, Bellza",
  themeColor: "#FAF8F4",
  locale: "pt_PT",
  url: `${CANONICAL_ORIGIN}/`,
} as const;
