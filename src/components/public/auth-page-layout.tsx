import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { BellzaLogo } from "@/components/bellza-logo";
import { ThemeToggle } from "@/components/theme-toggle";
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
    <div className="public-shell min-h-dvh lg:h-dvh lg:overflow-hidden">
      <div className="public-grid-bg pointer-events-none fixed inset-0 opacity-35" aria-hidden="true" />
      <div
        className={cn(
          "relative mx-auto flex min-h-dvh w-full flex-col px-4 py-6 sm:px-6 lg:h-full lg:min-h-0 lg:flex-row lg:items-center",
          isLogin ? "max-w-5xl lg:gap-10 lg:py-8" : "max-w-6xl lg:gap-12 lg:py-6",
        )}
      >
        <aside
          className={cn(
            "hidden lg:flex lg:flex-col lg:justify-center",
            isLogin ? "lg:w-[44%]" : "lg:w-[38%] lg:py-4",
          )}
        >
          {isLogin ? <LoginAside /> : <DefaultAside />}
        </aside>

        <main className="flex flex-1 flex-col justify-center lg:min-h-0">
          <div className="relative mb-7 flex items-center justify-center lg:hidden">
            <BellzaLogo variant="mobile" />
            <ThemeToggle className="absolute right-0 top-1/2 size-9 -translate-y-1/2" />
          </div>

          <div
            className={cn(
              "public-card mx-auto w-full p-5 shadow-[0_18px_60px_oklch(0_0_0/0.08)] sm:p-6",
              isLogin
                ? "max-w-[23rem] rounded-[1.35rem] lg:mx-auto lg:max-w-[22.75rem] lg:p-6"
                : "max-w-md lg:mx-0 lg:max-w-[26rem]",
            )}
          >
            <div className="mb-4 hidden items-center justify-between lg:flex">
              {isLogin ? (
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Painel seguro</p>
              ) : (
                <span />
              )}
              <ThemeToggle className="size-9" />
            </div>
            <Link
              to="/"
              className="text-xs font-medium text-muted-foreground transition hover:text-foreground lg:hidden"
            >
              ← Voltar ao site
            </Link>
            <div className={cn("space-y-1.5", isLogin ? "mt-4 lg:mt-0" : "mt-3 lg:mt-0")}>
              <h2 className={cn("font-semibold tracking-tight", isLogin ? "text-[1.65rem] leading-tight" : "text-2xl")}>
                {title}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description ?? `Acesso seguro ao painel ${APP_BRAND.name}.`}
              </p>
            </div>
            <div className={cn(isLogin ? "mt-6" : "mt-5")}>{children}</div>
            {footer && <div className={cn("border-t border-border/70", isLogin ? "mt-6 pt-5" : "mt-5 pt-5")}>{footer}</div>}
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
          Gestão premium para estúdios de beleza.
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{APP_BRAND.description}</p>
      </div>
    </div>
  );
}

function LoginAside() {
  return (
    <div className="relative max-w-sm">
      <div className="absolute -inset-8 rounded-[2rem] bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklch,var(--accent)_18%,transparent),transparent_38%)] blur-2xl" />
      <div className="relative space-y-7">
        <BellzaLogo variant="navbar" />
        <div className="space-y-3">
          <p className="public-section-label">{APP_BRAND.name}</p>
          <h1 className="text-balance text-[2.45rem] font-semibold leading-[1.04] tracking-tight">
            Entre no centro de comando do seu estúdio.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Agenda, equipa, pagamentos e clientes num painel elegante, seguro e preparado para o dia a dia.
          </p>
        </div>

        <div className="grid gap-3">
          <TrustRow icon={LockKeyhole} title="Acesso seguro" text="Sessão protegida e autenticação integrada." />
          <TrustRow icon={ShieldCheck} title="RGPD" text="Dados essenciais tratados com transparência." />
          <TrustRow icon={CheckCircle2} title="Operação premium" text="Tudo pronto para gerir marcações sem fricção." />
        </div>
      </div>
    </div>
  );
}

function TrustRow({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof LockKeyhole;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/55 p-3 shadow-sm backdrop-blur">
      <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
