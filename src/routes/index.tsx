import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  Check,
  CreditCard,
  Link2,
  MessageCircle,
  MonitorSmartphone,
  Scissors,
  Sparkles,
  UsersRound,
} from "lucide-react";
import studioHeroImg from "@/assets/studio-hero.jpg";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { ProductDemo } from "@/components/landing/product-demo";
import { APP_BRAND, LANDING_SEO } from "@/lib/app-brand";
import {
  DIFFERENTIATORS,
  FEATURE_BLOCKS,
  LANDING_FAQS,
  PLAN_FEATURES,
  PRICING_PLANS,
  PREVIEW_STUDIO,
  TRUST_PILLARS,
} from "@/lib/landing-content";

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

const featureIcons = [CalendarCheck, UsersRound, CreditCard, MessageCircle];

const HOW_IT_WORKS = [
  ["Configure", "Adicione serviços, equipa, horários, políticas e identidade do estúdio."],
  ["Partilhe", "Divulgue o link próprio da página pública ou peça ao cliente para guardar como app."],
  ["Acompanhe", "Veja reservas, clientes, pagamentos e notificações no painel da Bellza."],
] as const;

function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let cancelIdle: () => void = () => undefined;

    async function redirectAuthenticatedVisitor() {
      try {
        const [{ resolveAuthLanding, settleSessionFromCurrentUrl }, { isPublicCustomerUser }] =
          await Promise.all([import("@/lib/auth-landing"), import("@/lib/auth-context")]);
        if (cancelled) return;
        const session = await settleSessionFromCurrentUrl("/");
        if (cancelled || !session?.user?.id) return;
        const landing = await resolveAuthLanding(session.user.id);
        if (landing === "/onboarding" && isPublicCustomerUser(session.user)) return;
        if (!cancelled) navigate({ to: landing as never, replace: true });
      } catch {
        // Keep the public landing usable if an old or partial OAuth URL cannot be settled.
      }
    }

    const run = () => void redirectAuthenticatedVisitor();
    const idle = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idle.requestIdleCallback) {
      const id = idle.requestIdleCallback(run, { timeout: 1600 });
      cancelIdle = () => idle.cancelIdleCallback?.(id);
    } else {
      const id = window.setTimeout(run, 800);
      cancelIdle = () => window.clearTimeout(id);
    }

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [navigate]);

  async function startPlanCheckout(plan: "monthly" | "yearly") {
    setCheckoutPlan(plan);
    let showError: ((message: string) => void) | undefined;
    try {
      const [{ supabase }, { toast }] = await Promise.all([
        import("@/integrations/supabase/client"),
        import("sonner"),
      ]);
      showError = toast.error;
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
      if (!showError) {
        showError = (await import("sonner")).toast.error;
      }
      showError(error instanceof Error ? error.message : "Não foi possível abrir o checkout seguro.");
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
      price: plan.id === "monthly" ? "8.99" : "89.99",
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
        <section className="public-hero-section mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:pb-18 lg:pt-14">
          <div className="max-w-2xl text-center lg:text-left">
            <div className="mx-auto inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-[0_4px_14px_rgba(24,24,27,0.04)] lg:mx-0">
              <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate">Sistema de agendamento para salões e estúdios</span>
            </div>
            <h1 className="mx-auto mt-5 max-w-[42rem] text-balance text-[clamp(2.35rem,8.5vw,3.45rem)] font-semibold leading-[1.04] tracking-tight lg:mx-0 lg:text-[clamp(3rem,4.4vw,4.35rem)]">
              Mais marcações. Menos mensagens. O seu estúdio sempre organizado.
            </h1>
            <p className="mx-auto mt-5 max-w-[38rem] text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
              Receba reservas online, organize a equipa, envie lembretes e acompanhe os pagamentos num único lugar.
            </p>
            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
              <Link to="/signup" search={{ ref: undefined }} className="public-btn-primary h-12 w-full px-6 sm:w-auto">
                Começar 14 dias grátis
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a href="#como-funciona" className="public-btn-secondary h-12 w-full px-6 sm:w-auto">
                Ver como funciona
              </a>
            </div>
            <p className="mt-5 text-sm font-medium text-muted-foreground">
              Sem cartão • Sem fidelização • Cancele quando quiser
            </p>
          </div>

          <ProductDemo />
        </section>

        <section className="border-y border-border bg-surface-muted/65 py-5" aria-label="Indicadores da Bellza">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-2 px-4 sm:px-6 md:grid-cols-4">
            {TRUST_PILLARS.map((item) => (
              <div key={item.label} className="rounded-xl bg-card p-4 ring-1 ring-border">
                <p className="text-xl font-semibold tracking-tight sm:text-2xl">{item.value}</p>
                <p className="mt-1 text-xs font-medium leading-snug text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="como-funciona" className="mx-auto max-w-7xl scroll-mt-28 px-4 py-14 sm:px-6 sm:py-18">
          <SectionIntro
            label="Como funciona"
            title="Do link público ao painel, tudo conectado."
            description="O cliente marca sozinho e a equipa acompanha a operação no painel, sem perder a identidade do estúdio."
            centered
          />
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {HOW_IT_WORKS.map(([title, text], index) => (
              <article key={title} className="public-step-card">
                <span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                  {index + 1}
                </span>
                <h2 className="mt-4 text-lg font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="agenda" className="bg-surface-muted/65 py-14 sm:py-18">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <SectionIntro
              label="Agenda"
              title="Veja o seu dia num instante."
              description="Reservas, horários e profissionais organizados numa visão clara, com estados importantes à vista."
            />
            <ProductDemo />
          </div>
        </section>

        <section id="produto" className="mx-auto grid max-w-7xl scroll-mt-28 gap-8 px-4 py-14 sm:px-6 sm:py-18 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <PublicPhonePreview />
          <SectionIntro
            label="Página pública"
            title="O cliente marca em poucos passos."
            description="Uma experiência simples, personalizada e focada no seu estúdio, pronta para telemóvel e fácil de partilhar."
          />
        </section>

        <section id="funcionalidades" className="bg-surface-muted/65 py-14 sm:py-18">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Funcionalidades"
              title="Quatro áreas essenciais para gerir melhor."
              description="Reservas, equipa, clientes e pagamentos ficam agrupados de forma simples, sem transformar a página numa lista interminável."
              centered
            />
            <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {FEATURE_BLOCKS.map((feature, index) => {
                const Icon = featureIcons[index] ?? BadgeCheck;
                return (
                  <article key={feature.title} className="public-feature-card group">
                    <div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent transition group-hover:bg-accent group-hover:text-accent-foreground">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <h2 className="text-lg font-semibold">{feature.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                    <ul className="mt-4 grid gap-2">
                      {feature.points.map((point) => (
                        <li key={point} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                          <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="diferenciais" className="mx-auto max-w-7xl scroll-mt-28 px-4 py-14 sm:px-6 sm:py-18">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <SectionIntro
              label="Marca própria"
              title="A Bellza não coloca o seu estúdio dentro de um marketplace."
              description="A infraestrutura é da Bellza, mas a experiência é do seu negócio: o seu link, a sua página, a sua agenda e os seus clientes."
            />
            <div className="grid gap-3 md:grid-cols-3">
              {DIFFERENTIATORS.map((item) => (
                <article key={item.title} className="public-card p-5">
                  <BadgeCheck className="size-5 text-accent" aria-hidden="true" />
                  <h2 className="mt-4 text-xl font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="planos" className="scroll-mt-28 bg-surface-muted/65 py-14 sm:py-18">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Planos"
              title="Preço simples para entrar cedo na Bellza."
              description="Teste gratuito de 14 dias, condições especiais de lançamento e funcionalidades atuais incluídas nesta fase da plataforma."
              centered
            />
            <div className="mt-8 grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
              <div className="public-card p-5">
                <h2 className="text-lg font-semibold">Incluído nos planos</h2>
                <ul className="mt-4 grid gap-2">
                  {PLAN_FEATURES.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {PRICING_PLANS.map((plan) => (
                  <article
                    key={plan.name}
                    className={`relative rounded-2xl border bg-card p-6 shadow-[0_10px_30px_rgba(24,24,27,0.045)] ${
                      plan.highlighted ? "border-accent/55 ring-4 ring-accent/10" : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap gap-2">
                      {plan.badges.map((badge) => (
                        <span
                          key={badge}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            plan.highlighted ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                    <h3 className="mt-5 text-xl font-semibold">{plan.name}</h3>
                    <div className="mt-4 flex items-end gap-2">
                      <p className="text-4xl font-semibold tracking-tight">{plan.price}</p>
                      <p className="pb-1 text-sm text-muted-foreground">{plan.cadence}</p>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{plan.total}</p>
                    <p className="mt-1 text-xs font-semibold text-accent">{plan.equivalent}</p>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      Inclui todas as funcionalidades disponíveis nesta fase de lançamento.
                    </p>
                    <button
                      type="button"
                      onClick={() => startPlanCheckout(plan.id)}
                      disabled={checkoutPlan === plan.id}
                      className="public-btn-primary mt-6 w-full disabled:opacity-60"
                    >
                      {checkoutPlan === plan.id ? "A abrir checkout..." : "Começar teste grátis"}
                    </button>
                  </article>
                ))}
              </div>
            </div>
            <p className="mx-auto mt-6 max-w-3xl text-center text-xs leading-relaxed text-muted-foreground">
              A Bellza encontra-se em evolução contínua. No futuro poderão ser disponibilizados novos planos,
              funcionalidades e condições comerciais. As alterações não afetam retroativamente aquilo que for
              contratado, salvo comunicação prévia e nos termos aplicáveis.
            </p>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-28 px-4 py-14 sm:px-6 sm:py-18">
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
                    className="flex min-h-12 w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold"
                  >
                    <span>{faq.question}</span>
                    <ArrowRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-border px-5 pb-4 pt-1 text-sm leading-relaxed text-muted-foreground">
                      <p className="pt-3">{faq.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="px-4 pb-16 sm:px-6">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border bg-card p-7 text-center shadow-[0_16px_45px_rgba(24,24,27,0.05)] sm:p-10">
            <p className="public-section-label">Bellza para negócios de beleza</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
              Dê ao seu estúdio uma presença digital própria.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Comece com página pública, aplicativo PWA, agenda online, clientes, pagamentos e notificações num painel simples.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/signup" search={{ ref: undefined }} className="public-btn-primary">
                Criar conta Bellza
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link to="/login" className="public-btn-secondary">
                Entrar no painel
              </Link>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}

function PublicPhonePreview() {
  return (
    <div className="mx-auto w-full max-w-sm lg:max-w-md">
      <div className="public-card mx-auto max-w-[18rem] p-2 sm:max-w-[20rem]">
        <div className="overflow-hidden rounded-[1.4rem] bg-background">
          <div className="relative h-44">
            <img
              src={studioHeroImg}
              alt="Página pública do Studio Bellza no telemóvel"
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/68 via-black/12 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 text-white">
              <p className="text-xs opacity-85">{PREVIEW_STUDIO.domain}</p>
              <h2 className="text-xl font-semibold leading-tight">{PREVIEW_STUDIO.name}</h2>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded-xl bg-muted/65 p-3">
              <p className="text-sm font-semibold">Escolha o serviço</p>
              <p className="mt-1 text-xs text-muted-foreground">Manicure gel · 45 min · 18 €</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
              {["09:00", "10:30", "14:00"].map((time, index) => (
                <span
                  key={time}
                  className={index === 1 ? "rounded-lg bg-accent px-2 py-2 text-accent-foreground" : "rounded-lg bg-card px-2 py-2 ring-1 ring-border"}
                >
                  {time}
                </span>
              ))}
            </div>
            <div className="rounded-xl bg-accent px-3 py-2.5 text-center text-xs font-semibold text-accent-foreground">
              Confirmar reserva
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionIntro({
  label,
  title,
  description,
  centered,
}: {
  label: string;
  title: string;
  description?: string;
  centered?: boolean;
}) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className="public-section-label">{label}</p>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {description}
        </p>
      )}
    </div>
  );
}
