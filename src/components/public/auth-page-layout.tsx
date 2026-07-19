import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";
import { BellzaLogo } from "@/components/bellza-logo";
import { APP_BRAND } from "@/lib/app-brand";
import { cn } from "@/lib/utils";

type AuthPageLayoutProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "default" | "login";
};

export function AuthPageLayout({
  title,
  description,
  children,
  footer,
  variant = "default",
}: AuthPageLayoutProps) {
  const isLogin = variant === "login";

  return (
    <div className="public-shell public-site-theme public-auth-surface min-h-dvh overflow-x-hidden">
      <div
        className={cn(
          "relative mx-auto grid min-h-dvh w-full max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_0.92fr] lg:items-center lg:py-10",
          !isLogin && "lg:grid-cols-[0.9fr_0.9fr]",
        )}
      >
        <aside className="hidden lg:block">
          {isLogin ? <LoginAside /> : <DefaultAside />}
        </aside>

        <main className="flex min-w-0 flex-col justify-center">
          <div className="mb-7 flex items-center justify-center lg:hidden">
            <BellzaLogo variant="mobile" />
          </div>

          <div className="public-card public-auth-card mx-auto w-full max-w-[28rem] p-5 sm:p-6 lg:p-7">
            <Link
              to="/"
              className="mb-5 inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground transition hover:text-foreground lg:hidden"
            >
              Voltar ao site
            </Link>
            <div className="hidden items-center justify-between lg:mb-5 lg:flex">
              <BellzaLogo variant="mobile" />
              <span className="rounded-full bg-muted/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                Painel seguro
              </span>
            </div>
            <div className="space-y-2">
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description ?? `Acesso seguro ao painel ${APP_BRAND.name}.`}
              </p>
            </div>
            <div className="mt-6">{children}</div>
            {footer && <div className="mt-6 border-t border-border/60 pt-5">{footer}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}

function DefaultAside() {
  return (
    <div className="max-w-md space-y-6">
      <BellzaLogo variant="navbar" />
      <div className="space-y-3">
        <p className="public-section-label">{APP_BRAND.name}</p>
        <h2 className="text-balance text-4xl font-semibold leading-tight tracking-tight">
          Aplicativo próprio e gestão simples para estúdios.
        </h2>
        <p className="text-base leading-relaxed text-muted-foreground">{APP_BRAND.description}</p>
      </div>
      <AuthBenefitStrip />
    </div>
  );
}

function LoginAside() {
  return (
    <div className="relative max-w-xl">
      <div className="public-auth-preview">
        <BellzaLogo variant="navbar" />
        <div className="mt-8 max-w-md space-y-3">
          <p className="public-section-label">Painel Bellza</p>
          <h2 className="text-balance text-4xl font-semibold leading-tight tracking-tight">
            Entre no painel do seu estúdio com uma experiência clara.
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            Agenda, clientes, pagamentos e app próprio num ambiente leve, seguro e preparado para mobile.
          </p>
        </div>
        <div className="mt-8 rounded-2xl bg-card/82 p-4 ring-1 ring-border/60">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Hoje</p>
              <p className="mt-1 text-lg font-semibold">Reservas confirmadas</p>
            </div>
            <span className="rounded-full bg-accent/12 px-3 py-1 text-xs font-semibold text-accent">Online</span>
          </div>
          <div className="mt-4 grid gap-2">
            {["09:00 · Design de sobrancelhas", "10:30 · Manicure gel", "14:00 · Corte + barba"].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-xl bg-background/70 p-3">
                <CalendarCheck className="size-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate text-sm font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <AuthBenefitStrip />
      </div>
    </div>
  );
}

function AuthBenefitStrip() {
  return (
    <div className="flex flex-wrap gap-2">
      {[
        [CheckCircle2, "App próprio"],
        [CalendarCheck, "Agenda online"],
        [CreditCard, "Pagamentos"],
        [ShieldCheck, "Sessões seguras"],
      ].map(([Icon, item]) => {
        const TypedIcon = Icon as typeof CheckCircle2;
        return (
          <span
            key={item as string}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border/60 bg-card/72 px-3 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            <TypedIcon className="size-3.5 text-accent" aria-hidden="true" />
            {item as string}
          </span>
        );
      })}
    </div>
  );
}
