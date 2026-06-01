import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BellzaLogo } from "@/components/bellza-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { LandingFooter } from "@/components/landing/landing-footer";
import { APP_BRAND } from "@/lib/app-brand";

type LegalPageLayoutProps = {
  title: string;
  updatedAt: string;
  description?: string;
  children: ReactNode;
};

export function LegalPageLayout({ title, updatedAt, description, children }: LegalPageLayoutProps) {
  return (
    <div className="public-shell min-h-screen">
      <div className="public-grid-bg pointer-events-none fixed inset-0 opacity-35" aria-hidden="true" />
      <header className="public-nav">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <BellzaLogo variant="navbar" />
          <div className="flex items-center gap-2">
            <Link to="/" className="public-btn-ghost hidden sm:inline-flex">
              Início
            </Link>
            <ThemeToggle className="size-9" />
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="public-section-label">{APP_BRAND.name}</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {description && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Última atualização: {updatedAt}</p>
        <div className="public-prose mt-10">{children}</div>
      </main>

      <LandingFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="public-legal-section">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
