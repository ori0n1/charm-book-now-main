import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarCheck,
  Check,
  CreditCard,
  Link2,
  LockKeyhole,
  MessageCircle,
  MonitorSmartphone,
  Scissors,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { ProductDemo } from "@/components/landing/product-demo";
import { APP_BRAND, LANDING_SEO } from "@/lib/app-brand";
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

const featureIcons = [MonitorSmartphone, CalendarCheck, UsersRound, WalletCards, BellRing, ShieldCheck];

const PROBLEMS = [
  ["Mensagens a mais", "Reservas, alterações e confirmações deixam de depender só do WhatsApp."],
  ["Agenda espalhada", "Horários, equipa, bloqueios e reservas ficam organizados num único painel."],
  ["Marca pouco visível", "O cliente marca no link do seu estúdio, com a sua identidade em destaque."],
] as const;

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
        <section className="public-hero-section relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-8 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12 lg:pb-18 lg:pt-12">
          <div className="max-w-2xl text-center lg:text-left">
            <div className="mx-auto inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-card/88 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm lg:mx-0">
              <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate">Sistema de agendamento para salões e estúdios</span>
            </div>
            <h1 className="mx-auto mt-5 max-w-[42rem] text-balance text-[clamp(2.25rem,9vw,3.35rem)] font-semibold leading-[1.04] tracking-tight lg:mx-0 lg:text-[clamp(2.85rem,4.2vw,4.15rem)]">
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
              Sem cartão · Sem fidelização · Cancele quando quiser
            </p>
          </div>

          <ProductDemo />
        </section>

        <section className="border-y border-border/60 bg-card/32 py-5" aria-label="Indicadores da Bellza">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-2 px-4 sm:px-6 md:grid-cols-4">
            {TRUST_PILLARS.map((item) => (
              <div key={item.label} className="rounded-xl bg-background/70 p-4 ring-1 ring-border/50">
                <p className="text-xl font-semibold tracking-tight sm:text-2xl">{item.value}</p>
                <p className="mt-1 text-xs font-medium leading-snug text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18">
          <SectionIntro
            label="Problemas que resolve"
            title="Menos improviso na agenda, mais controlo no crescimento."
            description="A Bellza organiza os pontos mais sensíveis da rotina de salões, barbearias, manicures e estúdios de estética."
          />
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {PROBLEMS.map(([title, text]) => (
              <article key={title} className="public-card p-5">
                <Scissors className="size-5 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="como-funciona" className="scroll-mt-28 border-y border-border/60 bg-card/30 py-14 sm:py-18">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Como funciona"
              title="Do link público ao painel, tudo conectado."
              description="O cliente marca sozinho e a equipa acompanha a operação no painel, sem perder a identidade do estúdio."
              centered
            />
            <div className="mt-8 grid gap-3 md:grid-cols-3">
              {HOW_IT_WORKS.map(([title, text], index) => (
                <article key={title} className="public-step-card">
                  <span className="grid size-8 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
                    {index + 1}
                  </span>
                  <h2 className="mt-4 text-lg font-semibold">{title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="funcionalidades" className="mx-auto max-w-7xl scroll-mt-28 px-4 py-14 sm:px-6 sm:py-18">
          <SectionIntro
            label="Funcionalidades"
            title="O essencial para reservas, equipa, clientes e pagamentos."
            description="A comunicação fica mais curta, a agenda fica clara e cada estúdio mantém a sua presença digital própria."
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
                        <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>

        <section id="produto" className="mx-auto grid max-w-7xl scroll-mt-28 gap-8 px-4 py-14 sm:px-6 sm:py-18 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <SectionIntro
            label="Produto"
            title="A sua marca, o seu link, os seus clientes."
            description="A Bellza oferece a infraestrutura. O cliente continua a ver o estúdio como protagonista, da página pública à confirmação da reserva."
          />
          <div className="public-card overflow-hidden p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-foreground p-4 text-background">
                <Link2 className="size-5 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-semibold">Página própria</h2>
                <p className="mt-2 text-sm leading-relaxed text-background/66">
                  Link direto para reservas, sem concorrentes e com a identidade do estúdio em primeiro plano.
                </p>
              </div>
              <div className="rounded-2xl bg-muted/48 p-4">
                <MonitorSmartphone className="size-5 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-semibold">App instalável</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  O cliente pode guardar a página no ecrã inicial do telemóvel como PWA.
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MODULES.map((module) => (
                <div key={module} className="rounded-xl bg-background/70 p-3 text-sm font-semibold ring-1 ring-border/45">
                  {module}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border/60 bg-card/30 py-14 sm:py-18">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <SectionIntro
                label="Gestão diária"
                title="Agenda, pagamentos e notificações com leitura rápida."
                description="A equipa acompanha reservas confirmadas, pagamentos presenciais ou online, mensagens e estados importantes sem perder tempo a procurar informação."
              />
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  [CalendarCheck, "Agenda clara"],
                  [CreditCard, "Pagamentos acompanhados"],
                  [MessageCircle, "Lembretes e avisos"],
                ].map(([Icon, title]) => {
                  const TypedIcon = Icon as typeof CalendarCheck;
                  return (
                    <div key={title as string} className="rounded-xl bg-background/70 p-4 ring-1 ring-border/50">
                      <TypedIcon className="size-5 text-accent" aria-hidden="true" />
                      <p className="mt-3 text-sm font-semibold">{title as string}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="public-card p-5">
              <p className="public-section-label">Segurança</p>
              <div className="mt-4 grid gap-3">
                {SECURITY_POINTS.map((point) => (
                  <div key={point} className="flex items-start gap-3 rounded-xl bg-background/68 p-3 ring-1 ring-border/45">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                    <p className="text-sm leading-relaxed text-muted-foreground">{point}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="diferenciais" className="mx-auto max-w-7xl scroll-mt-28 px-4 py-14 sm:px-6 sm:py-18">
          <SectionIntro
            label="Por que Bellza"
            title="Premium sem parecer complicado."
            description="Uma experiência neutra e profissional para salões femininos, barbearias, estúdios mistos e profissionais independentes."
            centered
          />
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {DIFFERENTIATORS.map((item) => (
              <article key={item.title} className="public-card p-5">
                <BadgeCheck className="size-5 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="indicacao" className="scroll-mt-28 border-y border-border/60 bg-card/30 py-14 sm:py-18">
          <div className="mx-auto grid max-w-7xl gap-7 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <SectionIntro
              label="Programa de indicação"
              title="Indique outros estúdios e reduza o custo da Bellza."
              description="Cada estúdio recebe um link exclusivo. Quando uma indicação se torna assinante por pelo menos 30 dias, o estúdio que indicou recebe crédito equivalente ao valor mensal do plano."
            />
            <div className="public-card p-5">
              <ol className="grid gap-2">
                {REFERRAL_STEPS.map((step, index) => (
                  <li key={step} className="flex gap-3 rounded-xl bg-background/66 p-3 text-sm ring-1 ring-border/45">
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

        <section id="planos" className="scroll-mt-28 bg-foreground py-14 text-background sm:py-18">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Planos"
              title="Preço simples para entrar cedo na Bellza."
              description="Teste gratuito de 14 dias, condições especiais de lançamento e funcionalidades atuais incluídas nesta fase da plataforma."
              inverted
              centered
            />
            <div className="mt-8 grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
              <div className="rounded-2xl border border-background/10 bg-background/[0.04] p-5">
                <h2 className="text-lg font-semibold">Incluído nos planos</h2>
                <ul className="mt-4 grid gap-2">
                  {PLAN_FEATURES.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-background/74">
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
                    className={`relative rounded-2xl border p-6 ${
                      plan.highlighted
                        ? "border-accent bg-background text-foreground shadow-[0_24px_80px_oklch(0_0_0/0.22)]"
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
                    <p className={`mt-3 text-xs leading-relaxed ${plan.highlighted ? "text-muted-foreground" : "text-background/52"}`}>
                      Inclui todas as funcionalidades disponíveis nesta fase de lançamento.
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
            <p className="mx-auto mt-6 max-w-3xl text-center text-xs leading-relaxed text-background/50">
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
                    <div className="border-t border-border/60 px-5 pb-4 pt-1 text-sm leading-relaxed text-muted-foreground">
                      <p className="pt-3">{faq.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="px-4 pb-16 sm:px-6">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border/75 bg-card p-7 text-center shadow-[0_20px_70px_oklch(0_0_0/0.08)] sm:p-10">
            <p className="public-section-label">Bellza para negócios de beleza</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
              Dê ao seu estúdio uma presença digital própria.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Comece com página pública, aplicativo PWA, agenda online, clientes, pagamentos e notificações num painel premium.
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
      <p className={`public-section-label ${inverted ? "text-background/48" : ""}`}>{label}</p>
      <h2 className={`mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl ${inverted ? "text-background" : ""}`}>
        {title}
      </h2>
      {description && (
        <p className={`mt-3 text-sm leading-relaxed sm:text-base ${inverted ? "text-background/64" : "text-muted-foreground"}`}>
          {description}
        </p>
      )}
    </div>
  );
}
