import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  CreditCard,
  MessageCircle,
  MonitorSmartphone,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { ProductDemo, ProductStoryCarousel } from "@/components/landing/product-demo";
import {
  PlanComparison,
  PlanPeriodToggle,
  PlanSummaryCard,
} from "@/components/plans/plan-presentation";
import { SnapCarousel } from "@/components/snap-carousel";
import { APP_BRAND, LANDING_SEO } from "@/lib/app-brand";
import {
  BELLZA_APP_ICON_512,
  BELLZA_APPLE_TOUCH_ICON,
  BELLZA_FAVICON,
  BELLZA_MANIFEST,
} from "@/lib/brand-assets";
import { serializeJsonForHtmlScript } from "@/lib/output-safety";
import {
  DIFFERENTIATORS,
  FEATURE_BLOCKS,
  LANDING_FAQS,
  PLAN_COMPARISON,
  PLAN_FEATURES,
  PRICING_PLANS,
  TRUST_PILLARS,
} from "@/lib/landing-content";
import {
  prepareStripeBillingNavigation,
  requestPlatformCheckout,
} from "@/lib/subscription-checkout";

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
      { property: "og:image", content: BELLZA_APP_ICON_512 },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "512" },
      { property: "og:image:height", content: "512" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: LANDING_SEO.title },
      { name: "twitter:description", content: LANDING_SEO.description },
      { name: "twitter:image", content: BELLZA_APP_ICON_512 },
      { name: "robots", content: "index,follow,max-image-preview:large" },
      { name: "facebook-domain-verification", content: "q6b5r9wgjh0npcmg3gpcfzvn4hleky" },
      { name: "theme-color", content: LANDING_SEO.themeColor },
    ],
    links: [
      { rel: "canonical", href: LANDING_SEO.url },
      { rel: "manifest", href: BELLZA_MANIFEST },
      { rel: "icon", href: BELLZA_FAVICON, type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: BELLZA_APPLE_TOUCH_ICON, sizes: "180x180" },
    ],
  }),
  component: LandingPage,
});

const featureIcons = [CalendarCheck, UsersRound, CreditCard, MessageCircle];

const HOW_IT_WORKS = [
  ["Configure o essencial", "Adicione os serviços, a equipa e os horários do seu espaço."],
  ["Partilhe o seu link", "O cliente escolhe o serviço e marca sem depender de mensagens."],
  ["Acompanhe tudo", "Agenda, clientes, pagamentos e avisos ficam ligados no painel."],
] as const;

function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [interactive, setInteractive] = useState(false);
  const navigate = useNavigate();

  useEffect(() => setInteractive(true), []);

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

  async function startPlanCheckout(
    plan: "pro_monthly" | "pro_yearly" | "premium_monthly" | "premium_yearly",
  ) {
    // Reserve the external browser synchronously while the original PWA tap is
    // still active. iOS can reject window.open after any awaited operation.
    const navigation = prepareStripeBillingNavigation();
    setCheckoutPlan(plan);
    let showError: ((message: string) => void) | undefined;
    try {
      const [{ ensureBrowserAuthReady, supabase }, { toast }] = await Promise.all([
        import("@/integrations/supabase/client"),
        import("sonner"),
      ]);
      showError = toast.error;
      await ensureBrowserAuthReady();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        navigation.cancel();
        navigate({ to: "/signup", search: { ref: undefined } });
        return;
      }

      const checkoutUrl = await requestPlatformCheckout({ plan });
      navigation.complete(checkoutUrl);
    } catch (error) {
      navigation.cancel();
      if (!showError) {
        showError = (await import("sonner")).toast.error;
      }
      showError(error instanceof Error ? error.message : "Não foi possível abrir o checkout seguro.");
    } finally {
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
    offers: PRICING_PLANS.flatMap((plan) => {
      if (plan.id === "free") {
        return [{
          "@type": "Offer",
          name: "Bellza Free",
          priceCurrency: "EUR",
          price: "0",
          url: `${LANDING_SEO.url}#planos`,
        }];
      }
      const monthlyPrice = plan.id === "pro" ? "12.99" : "24.99";
      const yearlyPrice = plan.id === "pro" ? "129" : "249";
      return [
        {
          "@type": "Offer",
          name: `Bellza ${plan.name} mensal`,
          priceCurrency: "EUR",
          price: monthlyPrice,
          url: `${LANDING_SEO.url}#planos`,
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: monthlyPrice,
            priceCurrency: "EUR",
            billingDuration: "P1M",
          },
        },
        {
          "@type": "Offer",
          name: `Bellza ${plan.name} anual`,
          priceCurrency: "EUR",
          price: yearlyPrice,
          url: `${LANDING_SEO.url}#planos`,
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: yearlyPrice,
            priceCurrency: "EUR",
            billingDuration: "P1Y",
          },
        },
      ];
    }),
    featureList: PLAN_FEATURES,
    areaServed: { "@type": "Country", name: "Portugal" },
    publisher: { "@type": "Organization", name: APP_BRAND.name, url: LANDING_SEO.url },
  };

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: APP_BRAND.name,
    url: LANDING_SEO.url,
    logo: `${LANDING_SEO.url}bellza-app-icon-512.png`,
    description: APP_BRAND.description,
    sameAs: [LANDING_SEO.url],
  };

  return (
    <div
      data-landing-interactive={interactive ? "true" : "false"}
      className="public-shell public-site-theme public-landing-theme min-h-screen overflow-x-hidden"
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonForHtmlScript(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonForHtmlScript(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonForHtmlScript(organizationSchema) }} />
      <LandingHeader brandTone="light" />

      <main>
        <section className="public-hero-section public-landing-hero">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-9 sm:px-6 sm:pb-16 sm:pt-12 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16 lg:pb-20 lg:pt-16">
          <div className="max-w-2xl text-center lg:text-left">
            <div className="public-landing-eyebrow mx-auto lg:mx-0">
              <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
              <span>Gestão para beleza e bem-estar</span>
            </div>
            <h1 className="mx-auto mt-5 max-w-[42rem] text-balance text-[clamp(2.45rem,10vw,3.65rem)] font-semibold leading-[1.01] tracking-[-0.045em] lg:mx-0 lg:text-[clamp(3.35rem,4.7vw,4.8rem)]">
              A forma simples e profissional de gerir o seu espaço.
            </h1>
            <p className="mx-auto mt-5 max-w-[38rem] text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
              Agenda, clientes, pagamentos e o dia a dia do seu espaço — organizados num só lugar.
            </p>
            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
              <Link to="/signup" search={{ ref: undefined }} className="public-btn-primary h-12 w-full px-6 sm:w-auto">
                Experimentar 14 dias grátis
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a href="#produto" className="public-btn-secondary h-12 w-full px-6 sm:w-auto">
                Ver o produto
              </a>
            </div>
            <ul className="public-hero-assurances" aria-label="Condições do período experimental">
              {['Sem cartão', 'Sem fidelização', 'Continue no Free'].map((item) => (
                <li key={item}>
                  <BadgeCheck className="size-4 shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <ProductDemo loading="eager" />
          </div>
        </section>

        <section className="public-trust-section" aria-label="Vantagens da Bellza">
          <div className="mx-auto grid max-w-7xl grid-cols-2 px-4 sm:px-6 md:grid-cols-4">
            {TRUST_PILLARS.map((item) => (
              <div key={item.label} className="public-trust-item">
                <p className="text-base font-semibold tracking-tight sm:text-lg">{item.value}</p>
                <p className="mt-1 text-xs font-medium leading-snug text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="como-funciona" className="mx-auto grid max-w-7xl scroll-mt-28 gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.82fr_1.18fr] lg:items-start lg:gap-16">
          <SectionIntro
            label="Menos trabalho manual"
            title="Da mensagem solta à agenda organizada."
            description="A Bellza liga a reserva do cliente à operação do seu espaço, para que cada dia comece mais claro."
          />
          <div className="public-process-list">
            {HOW_IT_WORKS.map(([title, text], index) => (
              <article key={title} className="public-process-step">
                <span aria-hidden="true">0{index + 1}</span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <ProductShowcase />

        <section id="funcionalidades" className="public-benefits-section scroll-mt-28 py-14 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Feito para o seu espaço"
              title="Menos tarefas. Mais atenção a quem entra pela porta."
              description="O essencial do negócio reunido numa experiência calma, rápida e fácil de aprender."
              centered
            />
            <div className="public-benefit-grid">
              {FEATURE_BLOCKS.map((feature, index) => {
                const Icon = featureIcons[index] ?? BadgeCheck;
                return (
                  <article key={feature.title} className="public-benefit-card group">
                    <div className="flex items-center gap-3">
                      <span className="public-benefit-icon">
                        <Icon className="size-[1.1rem]" aria-hidden="true" />
                      </span>
                      <h3 className="min-w-0 text-base font-semibold">{feature.title}</h3>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                    <p className="mt-4 text-xs font-semibold text-foreground/70">{feature.points.join(" · ")}</p>
                  </article>
                );
              })}
            </div>
            <div id="diferenciais" className="public-brand-band scroll-mt-28">
              <div className="public-brand-band-intro">
                <span className="public-brand-icon" aria-hidden="true">
                  <MonitorSmartphone className="size-5" />
                </span>
                <div>
                  <p className="public-section-label">A sua marca primeiro</p>
                  <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                    A tecnologia é Bellza. A experiência continua a ser sua.
                  </h2>
                </div>
              </div>
              <div className="public-brand-points">
              {DIFFERENTIATORS.map((item) => (
                <article key={item.title} className="min-w-0">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <BadgeCheck className="size-4 shrink-0 text-accent" aria-hidden="true" />
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                </article>
              ))}
              </div>
            </div>
          </div>
        </section>

        <section id="planos" className="public-pricing-section scroll-mt-28 py-14 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="flex flex-col gap-5 text-center md:flex-row md:items-end md:justify-between md:text-left">
              <SectionIntro
                label="Planos"
                title="Comece sem pressão. Cresça quando fizer sentido."
                description="Experimente 14 dias de Premium. Depois escolha o plano certo ou continue no Free sem perder os seus dados."
              />
              <div className="shrink-0">
                <PlanPeriodToggle value={billingCycle} onChange={setBillingCycle} />
              </div>
            </div>
            <SnapCarousel
              labels={PRICING_PLANS.map((plan) => plan.name)}
              ariaLabel="Planos Bellza"
              initialIndex={1}
              desktopGrid
              variant="plans"
              className="mt-7"
            >
              {PRICING_PLANS.map((plan) => {
                const selectedPlan = billingCycle === "monthly" ? plan.monthlyPlanId : plan.yearlyPlanId;
                return (
                  <PlanSummaryCard
                    key={plan.name}
                    name={plan.name}
                    positioning={plan.positioning}
                    tagline={plan.tagline}
                    price={billingCycle === "monthly" ? plan.monthlyPrice : plan.yearlyPrice}
                    period={billingCycle === "monthly" ? "mês" : "ano"}
                    highlights={plan.features}
                    saving={billingCycle === "yearly" ? plan.annualSaving : null}
                    recommended={plan.highlighted}
                    action={(
                      <button
                      type="button"
                      onClick={() => {
                        if (!selectedPlan) {
                          navigate({ to: "/signup", search: { ref: undefined } });
                          return;
                        }
                        void startPlanCheckout(selectedPlan);
                      }}
                      disabled={
                        plan.id !== "free" && checkoutPlan === selectedPlan
                      }
                      className="public-btn-primary w-full disabled:opacity-60"
                    >
                      {plan.id !== "free" && checkoutPlan === selectedPlan
                        ? "A abrir checkout..."
                        : plan.cta}
                    </button>
                    )}
                  />
                );
              })}
            </SnapCarousel>
            <PlanComparison rows={PLAN_COMPARISON} className="mx-auto mt-7 max-w-5xl" />
            <details className="mx-auto mt-3 max-w-4xl text-center text-[11px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer py-2 font-semibold text-foreground/70">Condições dos planos</summary>
              <p className="pb-2">
                A Bellza encontra-se em evolução contínua. Novas funcionalidades e condições serão comunicadas sem alterar retroativamente o que foi contratado, salvo nos termos aplicáveis.
              </p>
            </details>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-28 px-4 py-14 sm:px-6 sm:py-20">
          <SectionIntro label="Antes de começar" title="Perguntas frequentes" centered />
          <div className="mt-7 divide-y divide-border/75 border-y border-border/75">
            {LANDING_FAQS.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={faq.question}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="flex min-h-12 w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold"
                  >
                    <span>{faq.question}</span>
                    <ArrowRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="max-w-2xl pb-4 text-sm leading-relaxed text-muted-foreground">
                      <p>{faq.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="px-4 pb-16 sm:px-6 sm:pb-20">
          <div className="public-final-cta mx-auto max-w-5xl overflow-hidden p-7 text-center sm:p-12">
            <p className="public-section-label">O próximo dia pode ser mais simples</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
              Organize o seu espaço sem perder o toque pessoal.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Experimente agenda, página pública, clientes, pagamentos e comunicação num único painel.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/signup" search={{ ref: undefined }} className="public-btn-primary">
                Experimentar 14 dias grátis
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link to="/login" className="public-btn-secondary">
                Entrar no painel
              </Link>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter brandTone="light" />
    </div>
  );
}

function ProductShowcase() {
  return (
    <section id="produto" className="public-product-section relative scroll-mt-28 py-14 sm:py-20">
      <span id="agenda" className="absolute -top-24" aria-hidden="true" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionIntro
          label="Produto real"
          title="Veja a Bellza a trabalhar antes de experimentar."
          description="Screenshots atuais da conta de demonstração, com conteúdo fictício. Deslize para percorrer o dia a dia do produto."
          centered
        />
        <ProductStoryCarousel />
      </div>
    </section>
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
