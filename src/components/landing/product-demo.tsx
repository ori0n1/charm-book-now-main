import { Bell, CalendarCheck, CreditCard, Smartphone } from "lucide-react";

const PRINT_BASE = "/docs/guia-bellza/prints";

const productScreens = {
  overview: {
    src: `${PRINT_BASE}/inicio-desktop.png`,
    alt: "Painel inicial real da Bellza com resumo do estúdio, agenda futura e indicadores financeiros",
    badge: "painel.bellza.pt/inicio",
  },
  agenda: {
    src: `${PRINT_BASE}/agenda-desktop.png`,
    alt: "Ecrã real da agenda da Bellza com marcações, filtros, estados e valores",
    badge: "painel.bellza.pt/agenda",
  },
} as const;

type ProductDemoVariant = keyof typeof productScreens;

export function ProductDemo({
  variant = "overview",
  loading = "lazy",
}: {
  variant?: ProductDemoVariant;
  loading?: "eager" | "lazy";
}) {
  const screen = productScreens[variant];
  const showPublicPhone = variant === "overview";

  return (
    <div
      className={`public-product-demo ${showPublicPhone ? "" : "public-product-demo-flat"}`}
      aria-label="Demonstração visual clara da Bellza"
    >
      <div className="public-demo-desktop">
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/35 px-4 py-3">
          <span className="size-2.5 rounded-full bg-danger-soft ring-1 ring-danger/20" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-warning-soft ring-1 ring-warning/20" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-success-soft ring-1 ring-success/20" aria-hidden="true" />
          <span className="ml-3 rounded-full border border-border/70 bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            {screen.badge}
          </span>
        </div>

        <div className="public-demo-screenshot">
          <img
            src={screen.src}
            alt={screen.alt}
            width={2880}
            height={1920}
            className="h-full w-full object-contain object-top"
            loading={loading}
            decoding="async"
          />
        </div>
      </div>

      {showPublicPhone && (
        <div className="public-demo-phone" aria-label="Painel Bellza real no telemóvel">
          <div className="rounded-[1.8rem] border border-border bg-card p-2 shadow-[0_18px_45px_rgba(24,24,27,0.12)]">
            <div className="public-demo-phone-screen">
              <img
                src={`${PRINT_BASE}/inicio-mobile.png`}
                alt="Painel inicial real da Bellza no telemóvel com marcações, link público e atalhos rápidos"
                width={1170}
                height={1992}
                className="h-full w-full object-cover object-top"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </div>
      )}

      <div className="public-demo-chip public-demo-chip-top">
        <Bell className="size-4 text-accent" aria-hidden="true" />
        <span>Nova marcação recebida</span>
      </div>
      <div className="public-demo-chip public-demo-chip-bottom">
        <CreditCard className="size-4 text-accent" aria-hidden="true" />
        <span>Sinal online confirmado</span>
      </div>
      <div className="public-demo-badge" aria-hidden="true">
        <Smartphone className="size-4 text-accent" aria-hidden="true" />
        <span>A sua marca, o seu link, os seus clientes.</span>
      </div>
      <CalendarCheck className="public-demo-calendar" aria-hidden="true" />
    </div>
  );
}
