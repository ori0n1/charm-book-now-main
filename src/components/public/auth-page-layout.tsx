import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
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
    <div className={cn("public-shell min-h-dvh", isLogin && "lg:min-h-svh lg:overflow-hidden")}>
      <div className="public-grid-bg pointer-events-none fixed inset-0 opacity-30" aria-hidden="true" />
      <div
        className={cn(
          "relative mx-auto flex min-h-dvh w-full flex-col px-4 py-6 sm:px-6 lg:flex-row lg:items-center",
          isLogin ? "max-w-4xl lg:min-h-svh lg:gap-8 lg:py-3 xl:py-4" : "max-w-6xl lg:gap-12 lg:py-10",
        )}
      >
        <aside
          className={cn(
            "hidden lg:flex lg:flex-col lg:justify-center",
            isLogin ? "lg:w-[42%]" : "lg:w-[38%] lg:py-4",
          )}
        >
          {isLogin ? <LoginAside /> : <DefaultAside />}
        </aside>

        <main className={cn("flex flex-1 flex-col justify-center", isLogin && "lg:min-h-0")}>
          <div className="relative mb-7 flex items-center justify-center lg:hidden">
            <BellzaLogo variant="mobile" />
          </div>

          <div
            className={cn(
              "public-card mx-auto w-full p-5 shadow-[0_18px_60px_oklch(0_0_0/0.08)] sm:p-6",
              isLogin
                ? "max-w-[23.5rem] rounded-[1.35rem] lg:mx-auto lg:max-w-[21.5rem] lg:p-4"
                : "max-w-md lg:mx-0 lg:max-w-[26rem]",
            )}
          >
            <div className={cn("hidden items-center justify-between lg:flex", isLogin ? "mb-3" : "mb-4")}>
              {isLogin ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Painel seguro
                </p>
              ) : (
                <span />
              )}
            </div>
            <Link
              to="/"
              className="text-xs font-medium text-muted-foreground transition hover:text-foreground lg:hidden"
            >
              Voltar ao site
            </Link>
            <div className={cn("space-y-1.5", isLogin ? "mt-4 lg:mt-0" : "mt-3 lg:mt-0")}>
              <h2 className={cn("font-semibold tracking-tight", isLogin ? "text-[1.55rem] leading-tight" : "text-2xl")}>
                {title}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description ?? `Acesso seguro ao painel ${APP_BRAND.name}.`}
              </p>
            </div>
            <div className={cn(isLogin ? "mt-5" : "mt-5")}>{children}</div>
            {footer && <div className={cn("border-t border-border/70", isLogin ? "mt-5 pt-4" : "mt-5 pt-5")}>{footer}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}

function DefaultAside() {
  return (
    <div className="space-y-5">
      <BellzaLogo variant="navbar" />
      <div className="max-w-sm space-y-3">
        <p className="public-section-label">{APP_BRAND.name}</p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          Aplicativo próprio e gestão premium para estúdios.
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{APP_BRAND.description}</p>
      </div>
    </div>
  );
}

function LoginAside() {
  return (
    <div className="relative max-w-[22rem]">
      <div className="absolute -inset-5 rounded-[2rem] bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklch,var(--accent)_12%,transparent),transparent_44%)] blur-2xl" />
      <div className="relative space-y-4">
        <BellzaLogo variant="navbar" />
        <div className="space-y-2">
          <p className="public-section-label">{APP_BRAND.name}</p>
          <h1 className="text-balance text-[clamp(1.75rem,2.55vw,2.1rem)] font-semibold leading-[1.05] tracking-tight">
            Entre no painel do seu estúdio.
          </h1>
          <p className="max-w-[20rem] text-[0.8125rem] leading-relaxed text-muted-foreground">
            Agenda, clientes, pagamentos e app próprio num ambiente leve, seguro e preparado para mobile.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {["App próprio", "Agenda online", "Pagamentos", "Notificações"].map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/62 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm"
            >
              <CheckCircle2 className="size-3.5 text-accent" aria-hidden="true" />
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
