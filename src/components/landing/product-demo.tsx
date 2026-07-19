import { Bell, CalendarCheck, CreditCard, Smartphone } from "lucide-react";
import studioHeroImg from "@/assets/studio-hero.jpg";
import { PREVIEW_AGENDA, PREVIEW_FINANCE, PREVIEW_STUDIO } from "@/lib/landing-content";

export function ProductDemo() {
  return (
    <div className="public-product-demo" aria-label="Demonstração visual clara da Bellza">
      <div className="public-demo-desktop">
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/35 px-4 py-3">
          <span className="size-2.5 rounded-full bg-[#EF4444]" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-[#F59E0B]" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-[#22C55E]" aria-hidden="true" />
          <span className="ml-3 rounded-full border border-border/70 bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            painel.bellza.pt/agenda
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Agenda de hoje</p>
            <h2 className="text-xl font-semibold">Studio Bellza</h2>
          </div>
          <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            3 reservas
          </span>
        </div>

        <div className="grid gap-3 p-5">
          {PREVIEW_AGENDA.map((item) => (
            <div key={`${item.time}-${item.service}`} className="public-demo-row">
              <div className="public-demo-time">
                <p className="text-base font-semibold text-foreground">{item.time}</p>
                <p className="text-xs text-muted-foreground">{item.professional}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="public-demo-service text-base font-semibold">{item.service}</p>
                <p className="text-xs text-muted-foreground">{item.client}</p>
              </div>
              <span className="shrink-0 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                {item.status}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-border/60 bg-muted/25 p-5">
          {PREVIEW_FINANCE.map((item) => (
            <div key={item.label} className="rounded-xl bg-card p-3 ring-1 ring-border/55">
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{item.value}</p>
              <p className="text-[11px] text-muted-foreground">{item.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="public-demo-phone" aria-label="Página pública do estúdio no telemóvel">
        <div className="rounded-[1.8rem] border border-border bg-card p-2 shadow-[0_18px_45px_rgba(24,24,27,0.12)]">
          <div className="overflow-hidden rounded-[1.35rem] bg-background text-foreground">
            <div className="relative h-32">
              <img
                src={studioHeroImg}
                alt="Interior de estúdio de beleza"
                className="h-full w-full object-cover"
                loading="eager"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/68 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3 text-white">
                <p className="text-[11px] font-medium opacity-80">{PREVIEW_STUDIO.domain}</p>
                <h3 className="text-lg font-semibold leading-tight">{PREVIEW_STUDIO.name}</h3>
              </div>
            </div>
            <div className="space-y-3 p-3">
              <div className="flex items-center justify-between rounded-xl bg-muted/55 p-3">
                <div>
                  <p className="text-xs font-semibold">Manicure gel</p>
                  <p className="text-[11px] text-muted-foreground">45 min - Ana</p>
                </div>
                <span className="text-xs font-semibold">18 EUR</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] font-semibold">
                {["09:00", "10:30", "14:00"].map((time, index) => (
                  <span
                    key={time}
                    className={index === 1 ? "rounded-lg bg-accent px-2 py-2 text-accent-foreground" : "rounded-lg bg-muted/55 px-2 py-2"}
                  >
                    {time}
                  </span>
                ))}
              </div>
              <div className="rounded-xl bg-accent px-3 py-2 text-center text-xs font-semibold text-accent-foreground">
                Reservar agora
              </div>
            </div>
          </div>
        </div>
      </div>

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
