import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CreditCard,
  LockKeyhole,
  MessageCircle,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { CookieBanner } from "@/components/cookie-banner";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { ProductPreview } from "@/components/landing/product-preview";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND, LANDING_SEO } from "@/lib/app-brand";
import { resolveAuthLanding, settleSessionFromCurrentUrl } from "@/lib/auth-landing";
import {
  FEATURE_BLOCKS,
  LANDING_FAQS,
  PLAN_FEATURES,
  PRICING_PLANS,
  SECURITY_POINTS,
  TESTIMONIALS,
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
      { name: "theme-color", content: LANDING_SEO.themeColor },
    ],
    links: [
      { rel: "canonical", href: LANDING_SEO.url },
      { rel: "icon", href: "/bellza-logo.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/bellza-logo.png" },
    ],
  }),
  component: LandingPage,
});

const featureIcons = [CalendarDays, MessageCircle, CreditCard, WalletCards, UsersRound, MonitorSmartphone];

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

  async function startPlanCheckout(plan: "monthly" | "quarterly" | "yearly") {
    setCheckoutPlan(plan);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        navigate({ to: "/signup" });
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
          navigate({ to: "/signup" });
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
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir o checkout seguro da Stripe.",
      );
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
      price: plan.name.includes("Mensal") ? "8.99" : plan.name.includes("Trimestral") ? "22.49" : "71.99",
    })),
    areaServed: { "@type": "Country", name: "Portugal" },
    publisher: { "@type": "Organization", name: APP_BRAND.name },
  };

  return (
    <div className="public-shell min-h-screen overflow-x-hidden">
      <div className="public-grid-bg pointer-events-none fixed inset-0 opacity-35" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <LandingHeader />

      <main>
        <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14">
          <div className="min-w-0 max-w-3xl text-center lg:text-left">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur lg:mx-0">
              <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
              Bellza para estúdios e barbearias em Portugal
            </div>
            <h1 className="mx-auto mt-6 max-w-[20rem] text-3xl font-semibold leading-[1.08] tracking-tight sm:max-w-none sm:text-balance sm:text-5xl sm:leading-[1.03] lg:mx-0 lg:text-[4.35rem]">
              Gestão premium para transformar marcações em crescimento.
            </h1>
            <p className="mx-auto mt-5 max-w-[21rem] text-pretty text-base leading-relaxed text-muted-foreground sm:max-w-2xl sm:text-lg lg:mx-0">
              A {APP_BRAND.name} reúne agenda online, WhatsApp automático, pagamentos, equipa, clientes e
              finanças num SaaS moderno, rápido e preparado para a realidade legal europeia.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
              <Link to="/signup" className="public-btn-primary h-12 w-full px-6 sm:w-auto">
                Começar 14 dias grátis
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a href="#produto" className="public-btn-secondary h-12 w-full px-6 sm:w-auto">
                Ver painel Bellza
              </a>
            </div>
            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px] font-semibold text-muted-foreground sm:gap-x-5 sm:text-xs lg:justify-start">
              {["Sem fidelização", "Cancelamento simples", "Suporte premium", "Pronto para Stripe"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-accent" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <ProductPreview />
        </section>

        <section className="border-y border-border/70 bg-card/35 py-8" aria-label="Indicadores de confiança">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-5 px-4 sm:px-6 md:grid-cols-4">
            {TRUST_PILLARS.map((item) => (
              <div key={item.label} className="rounded-xl border border-border/60 bg-background/55 p-4">
                <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="funcionalidades" className="mx-auto max-w-7xl scroll-mt-28 px-4 py-16 sm:px-6 md:py-24">
          <SectionIntro
            label="Funcionalidades"
            title="O sistema operacional do seu estúdio."
            description="Cada módulo da Bellza foi pensado para negócios de serviços: menos administração, mais previsibilidade e uma experiência mais profissional para cada cliente."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {FEATURE_BLOCKS.map((feature, index) => {
              const Icon = featureIcons[index] ?? BadgeCheck;
              return (
                <article key={feature.title} className="public-feature-card group">
                  <div className="mb-5 inline-flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                  <ul className="mt-5 space-y-2">
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

        <section id="planos" className="scroll-mt-28 border-y border-border/70 bg-foreground py-16 text-background sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Planos"
              title="Preço simples, visual premium e sem surpresas."
              description="Todos os planos incluem 14 dias grátis, suporte premium, cancelamento simples e acesso ao produto completo."
              inverted
            />
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {PRICING_PLANS.map((plan) => (
                <article
                  key={plan.name}
                  className={`relative rounded-2xl border p-6 ${
                    plan.highlighted
                      ? "border-accent bg-background text-foreground shadow-[0_24px_80px_oklch(0_0_0/0.32)]"
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
                  <h3 className="mt-6 text-xl font-semibold">{plan.name}</h3>
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
                    className={`mt-7 w-full disabled:opacity-60 ${plan.highlighted ? "public-btn-primary" : "public-btn-secondary bg-background text-foreground"}`}
                  >
                    {checkoutPlan === plan.id ? "A abrir Stripe..." : "Começar grátis"}
                  </button>
                </article>
              ))}
            </div>
            <div className="mt-8 grid gap-3 rounded-2xl border border-background/10 bg-background/[0.04] p-5 md:grid-cols-4">
              {["14 dias grátis", "Sem fidelização", "Cancelamento simples", "Suporte premium"].map((item) => (
                <p key={item} className="flex items-center gap-2 text-sm font-semibold text-background/78">
                  <Check className="size-4 text-accent" />
                  {item}
                </p>
              ))}
            </div>
          </div>
        </section>

        <section id="seguranca" className="mx-auto grid max-w-7xl scroll-mt-28 gap-8 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionIntro
            label="Confiança e RGPD"
            title="Preparada para clientes exigentes, checkout transparente e operação real."
            description="A Bellza apresenta contacto oficial, políticas claras, informação sobre reembolso e cancelamento, e uma experiência coerente para aprovação de pagamentos."
          />
          <div className="grid gap-3">
            {SECURITY_POINTS.map((point) => (
              <div key={point} className="public-card flex items-start gap-3 p-4">
                <LockKeyhole className="mt-0.5 size-5 shrink-0 text-accent" />
                <p className="text-sm font-medium leading-relaxed">{point}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-border/70 bg-card/35 py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionIntro
              label="Prova de produto"
              title="Uma presença digital que transmite confiança antes da primeira marcação."
              description="Página pública do estúdio, checkout claro, confirmação operacional e painel de gestão com a mesma linguagem visual."
              centered
            />
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {TESTIMONIALS.map((testimonial) => (
                <figure key={testimonial.author} className="public-feature-card">
                  <ShieldCheck className="mb-5 size-5 text-accent" />
                  <blockquote className="text-base leading-relaxed">“{testimonial.quote}”</blockquote>
                  <figcaption className="mt-5 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{testimonial.author}</span> · {testimonial.context}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-28 px-4 py-16 sm:px-6 md:py-20">
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
                    <ChevronRight
                      className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                    />
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

        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border/80 bg-foreground p-8 text-center text-background shadow-[0_24px_80px_oklch(0_0_0/0.16)] sm:p-12">
            <p className="text-xs font-semibold uppercase text-background/45">Bellza em produção</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
              Dê ao seu estúdio a experiência digital que os clientes já esperam.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-background/62">
              Comece com 14 dias grátis, configure serviços e equipa, e publique a página de marcações do seu
              estúdio com uma imagem profissional.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/signup" className="public-btn-primary bg-background text-foreground">
                Criar conta Bellza
                <ArrowRight className="size-4" />
              </Link>
              <Link to="/contacto" className="public-btn-secondary border-background/15 bg-transparent text-background">
                Falar com suporte
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
