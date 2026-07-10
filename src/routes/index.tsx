import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Gift,
  Link2,
  LockKeyhole,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { CookieBanner } from "@/components/cookie-banner";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND, LANDING_SEO } from "@/lib/app-brand";
import { resolveAuthLanding, settleSessionFromCurrentUrl } from "@/lib/auth-landing";
import { isPublicCustomerUser } from "@/lib/auth-context";
import {
  DIFFERENTIATORS,
  FEATURE_BLOCKS,
  LANDING_FAQS,
  MODULES,
  PLAN_FEATURES,
  PRICING_PLANS,
  REFERRAL_STEPS,
  SECURITY_POINTS,
  TRUST_PILLARS,
} from "@/lib/landing-content";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: LANDING_SEO.title },
      { name: "description", content: LANDING_SEO.description },
      { name: "keywords", content: LANDING_SEO.keywords },
      { property: "og:title", content: LANDING_SEO.title },
      { property: "og:description", content: LANDING_SEO.description },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: LANDING_SEO.locale },
      { property: "og:site_name", content: APP_BRAND.name },
      { property: "og:url", content: LANDING_SEO.url },
      { property: "og:image", content: "/bellza-logo.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: LANDING_SEO.title },
      { name: "twitter:description", content: LANDING_SEO.description },
      { name: "twitter:image", content: "/bellza-logo.png" },
      { name: "robots", content: "index,follow,max-image-preview:large" },
      { name: "facebook-domain-verification", content: "q6b5r9wgjh0npcmg3gpcfzvn4hleky" },
      { name: "theme-color", content: LANDING_SEO.themeColor },
    ],
    links: [
      { rel: "canonical", href: LANDING_SEO.url },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/bellza-logo.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/bellza-logo.png" },
    ],
  }),
  component: LandingPage,
});

const featureIcons = [MonitorSmartphone, BadgeCheck, UsersRound, WalletCards, Sparkles, ShieldCheck];

const HERO_BENEFITS = [
  {
    title: "App próprio",
    text: "O cliente guarda o estúdio no telemóvel como PWA.",
  },
  {
    title: "Página personalizada",
    text: "Logo, cores, serviços e link exclusivo da sua marca.",
  },
  {
    title: "Agenda online",
    text: "Reservas diretas, disponibilidade real e menos mensagens manuais.",
  },
  {
    title: "Tudo ilimitado",
    text: "Profissionais, clientes, serviços, mensagens e notificações.",
  },
] as const;

const FAST_BENEFITS = [
  "14 dias grátis",
  "Sem fidelização",
  "Cancelar quando quiser",
  "Link próprio",
  "PWA instalável",
  "Programa de indicação",
] as const;

function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function redirectAuthenticatedVisitor() {
      try {
        const session = await settleSessionFromCurrentUrl("/");
        if (cancelled || !session?.user?.id) return;
        const landing = await resolveAuthLanding(session.user.id);
        if (landing === "/onboarding" && isPublicCustomerUser(session.user)) return;
        if (!cancelled) navigate({ to: landing as never, replace: true });
      } catch {
        // Keep the public landing usable if an old or partial OAuth URL cannot be settled.
      }
    }
    void redirectAuthenticatedVisitor();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function startPlanCheckout(plan: "monthly" | "yearly") {
    setCheckoutPlan(plan);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        navigate({ to: "/signup", search: { ref: undefined } });
        return;
      }

      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan }),
      });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        if (response.status === 401) {
          navigate({ to: "/signup", search: { ref: undefined } });
          return;
        }
        if (response.status === 409) {
          navigate({ to: "/admin/pagamentos" });
          return;
        }
        throw new Error(payload.error ?? "checkout_failed");
      }
      window.location.href = payload.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o checkout seguro.");
      setCheckoutPlan(null);
    }
  }

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: LANDING_FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: APP_BRAND.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    description: LANDING_SEO.description,
    url: LANDING_SEO.url,
    offers: PRICING_PLANS.map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      priceCurrency: "EUR",
      price: plan.id === "monthly" ? "8.99" : "71.99",
    })),
    featureList: PLAN_FEATURES,
    areaServed: { "@type": "Country", name: "Portugal" },
    publisher: { "@type": "Organization", name: APP_BRAND.name, url: LANDING_SEO.url },
  };

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: APP_BRAND.name,
    url: LANDING_SEO.url,
    logo: `${LANDING_SEO.url}bellza-logo.png`,
    description: APP_BRAND.description,
    sameAs: [LANDING_SEO.url],
  };

  return (
    <div className="public-shell min-h-screen overflow-x-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <LandingHeader />

      <main>
        <section className="relative mx-auto grid max-w-7xl items-center gap-7 px-4 pb-10 pt-6 sm:px-6 sm:pb-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-10 lg:pt-8">
          <div className="max-w-2xl text-center lg:text-left">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/82 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm lg:mx-0">
              <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
              Aplicativo próprio para salões, estética e barbearias
            </div>
            <h1 className="mx-auto mt-5 max-w-[38rem] text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:mx-0 lg:text-[clamp(2.75rem,4vw,3.25rem)]">
              O seu estúdio com página própria, app própria e agenda online.
            </h1>
            <p className="mx-auto mt-4 max-w-[36rem] text-pretty text-base leading-relaxed text-muted-foreground lg:mx-0">
              A Bellza ajuda o seu negócio a sair da dependência de marketplaces: cada estúdio tem o seu link, a sua identidade, a sua experiência de reserva e um painel completo para gerir tudo.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
              <Link to="/signup" search={{ ref: undefined }} className="public-btn-primary h-12 w-full px-6 sm:w-auto">
                Começar teste grátis
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a href="#aplicativo" className="public-btn-secondary h-12 w-full px-6 sm:w-auto">
                Ver como funciona
              </a>
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-2 text-left text-[11px] font-semibold text-muted-foreground sm:flex sm:flex-wrap sm:justify-center sm:text-xs lg:justify-start">
              {FAST_BENEFITS.map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-accent" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:gap-4">
            {HERO_BENEFITS.map((item, index) => {
              const Icon = featureIcons[index] ?? BadgeCheck;

              return (
                <article key={item.title} className="public-card p-4 sm:p-5">
                  <div className="mb-4 inline-flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  <h2 className="text-base font-semibold tracking-tight">{item.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="border-y border-border/70 bg-card/35 py-6" aria-label="Indicadores da Bellza">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 sm:px-6 md:grid-cols-4">
            {TRUST_PILLARS.map((item) => (
              <div key={item.label} className="rounded-xl border border-border/60 bg-background/62 p-4">
                <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="aplicativo" className="mx-auto grid max-w-7xl scroll-mt-28 gap-8 px-4 py-14 sm:px-6 md:py-18 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionIntro
            label="App próprio"
            title="O cliente guarda o seu estúdio no telemóvel."
            description="A Bellza cria uma experiência PWA: abre no navegador, pode ser adicionada ao ecrã inicial e mantém a identidade do seu estúdio em primeiro plano."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Página exclusiva", "Uma experiência pública só para o seu estúdio."],
              ["Instalável", "O cliente guarda no iPhone ou Android como app."],
              ["Reserva direta", "Sem concorrentes, sem anúncios, sem distração."],
            ].map(([title, text]) => (
              <article key={title} className="public-card p-4">
                <MonitorSmartphone className="size-5 text-accent" />
                <h2 className="mt-4 text-lg font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="diferenciais" className="border-y border-border/70 bg-card/30 py-14 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Por que Bellza"
              title="Independência digital sem perder simplicidade."
              description="A plataforma conecta vários estúdios, mas a experiência do cliente continua focada no estúdio que ele escolheu."
              centered
            />
            <div className="mt-8 grid gap-3 md:grid-cols-3">
              {DIFFERENTIATORS.map((item) => (
                <article key={item.title} className="public-card p-5">
                  <BadgeCheck className="size-5 text-accent" />
                  <h2 className="mt-4 text-xl font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="funcionalidades" className="mx-auto max-w-7xl scroll-mt-28 px-4 py-14 sm:px-6 md:py-18">
          <SectionIntro
            label="Sistema completo"
            title="Tudo incluído para gerir e crescer."
            description="O investimento é no sistema completo, não em limites artificiais de equipa, clientes ou mensagens."
          />
          <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {FEATURE_BLOCKS.map((feature, index) => {
              const Icon = featureIcons[index] ?? BadgeCheck;
              return (
                <article key={feature.title} className="public-feature-card group">
                  <div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <h2 className="text-lg font-semibold">{feature.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                  <ul className="mt-4 grid gap-2">
                    {feature.points.map((point) => (
                      <li key={point} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <Check className="size-3.5 text-accent" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>

        <section id="modulos" className="mx-auto grid max-w-7xl scroll-mt-28 gap-8 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[0.85fr_1.15fr]">
          <SectionIntro
            label="Modulos"
            title="Da primeira reserva ao controlo financeiro."
            description="Agenda, página pública, app PWA, equipa, clientes, pagamentos e comunicação vivem numa base única."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MODULES.map((module) => (
              <div key={module} className="rounded-xl border border-border/70 bg-card/70 p-4">
                <BadgeCheck className="size-4 text-accent" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold">{module}</h3>
              </div>
            ))}
          </div>
        </section>

        <section id="indicacao" className="scroll-mt-28 border-y border-border/70 bg-card/35 py-14 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-7 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/75 bg-background/75 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                <Gift className="size-3.5 text-accent" />
                Programa de indicação
              </div>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Indique outros estúdios e reduza o custo da Bellza.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                Cada estúdio recebe um link exclusivo. Quando uma indicação se torna assinante por pelo menos 30 dias, o estúdio que indicou recebe crédito equivalente ao valor mensal do seu plano.
              </p>
            </div>
            <div className="public-card p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-accent/12 text-accent">
                  <Link2 className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Quanto mais indica, menos paga.</p>
                  <p className="text-xs text-muted-foreground">Crédito aplicado automaticamente quando as regras são cumpridas.</p>
                </div>
              </div>
              <ol className="grid gap-2">
                {REFERRAL_STEPS.map((step, index) => (
                  <li key={step} className="flex gap-3 rounded-xl border border-border/60 bg-background/62 p-3 text-sm">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="planos" className="scroll-mt-28 bg-foreground py-14 text-background sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Planos"
              title="Preço simples, produto completo."
              description="Teste gratuito de 14 dias, cancelamento a qualquer momento no mensal e todos os recursos essenciais incluídos."
              inverted
            />
            <div className="mt-8 grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
              <div className="rounded-2xl border border-background/10 bg-background/[0.04] p-5">
                <h2 className="text-lg font-semibold">Incluído nos planos</h2>
                <ul className="mt-4 grid gap-2">
                  {PLAN_FEATURES.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-background/74">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {PRICING_PLANS.map((plan) => (
                  <article
                    key={plan.name}
                    className={`relative rounded-2xl border p-6 ${
                      plan.highlighted
                        ? "border-accent bg-background text-foreground shadow-[0_24px_80px_oklch(0_0_0/0.28)]"
                        : "border-background/12 bg-background/[0.04] text-background"
                    }`}
                  >
                    <div className="flex flex-wrap gap-2">
                      {plan.badges.map((badge) => (
                        <span
                          key={badge}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            plan.highlighted ? "bg-accent text-accent-foreground" : "bg-background/10 text-background/72"
                          }`}
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                    <h3 className="mt-5 text-xl font-semibold">{plan.name}</h3>
                    <div className="mt-4 flex items-end gap-2">
                      <p className="text-4xl font-semibold tracking-tight">{plan.price}</p>
                      <p className={`pb-1 text-sm ${plan.highlighted ? "text-muted-foreground" : "text-background/55"}`}>
                        {plan.cadence}
                      </p>
                    </div>
                    <p className={`mt-2 text-sm ${plan.highlighted ? "text-muted-foreground" : "text-background/58"}`}>
                      {plan.total}
                    </p>
                    <p className={`mt-1 text-xs font-semibold ${plan.highlighted ? "text-accent" : "text-background/48"}`}>
                      {plan.equivalent}
                    </p>
                    <button
                      type="button"
                      onClick={() => startPlanCheckout(plan.id)}
                      disabled={checkoutPlan === plan.id}
                      className={`mt-6 w-full disabled:opacity-60 ${plan.highlighted ? "public-btn-primary" : "public-btn-secondary bg-background text-foreground"}`}
                    >
                      {checkoutPlan === plan.id ? "A abrir checkout..." : "Começar teste grátis"}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="seguranca" className="mx-auto grid max-w-7xl scroll-mt-28 gap-8 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionIntro
            label="Segurança"
            title="Privacidade, políticas e auditoria desde o primeiro agendamento."
            description="A Bellza foi pensada para operações reais, com links seguros, registos de ações e comunicação transparente."
          />
          <div className="grid gap-3">
            {SECURITY_POINTS.map((point) => (
              <div key={point} className="public-card flex items-start gap-3 p-4">
                <LockKeyhole className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <p className="text-sm font-medium leading-relaxed">{point}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-28 px-4 py-14 sm:px-6 sm:py-16">
          <SectionIntro label="FAQ" title="Perguntas frequentes" centered />
          <div className="mt-8 space-y-2">
            {LANDING_FAQS.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={faq.question} className="public-card overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold"
                  >
                    <span>{faq.question}</span>
                    <ArrowRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-border/70 px-5 pb-4 pt-1 text-sm leading-relaxed text-muted-foreground">
                      <p className="pt-3">{faq.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="px-4 pb-16 sm:px-6">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border/80 bg-foreground p-7 text-center text-background shadow-[0_24px_80px_oklch(0_0_0/0.16)] sm:p-10">
            <p className="text-xs font-semibold uppercase text-background/45">Bellza para negócios de beleza</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
              Dê ao seu estúdio uma presença digital própria.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-background/62">
              Comece com página pública, aplicativo PWA, agenda online, clientes, pagamentos e notificações num painel premium.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/signup" search={{ ref: undefined }} className="public-btn-primary bg-background text-foreground">
                Criar conta Bellza
                <ArrowRight className="size-4" />
              </Link>
              <Link to="/login" className="public-btn-secondary border-background/15 bg-transparent text-background">
                Entrar no painel
              </Link>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
      <CookieBanner />
    </div>
  );
}

function SectionIntro({
  label,
  title,
  description,
  centered,
  inverted,
}: {
  label: string;
  title: string;
  description?: string;
  centered?: boolean;
  inverted?: boolean;
}) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className={`public-section-label ${inverted ? "text-background/45" : ""}`}>{label}</p>
      <h2 className={`mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl ${inverted ? "text-background" : ""}`}>
        {title}
      </h2>
      {description && (
        <p className={`mt-3 text-sm leading-relaxed sm:text-base ${inverted ? "text-background/62" : "text-muted-foreground"}`}>
          {description}
        </p>
      )}
    </div>
  );
}
