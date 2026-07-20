import type { ReactNode } from "react";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { APP_BRAND } from "@/lib/app-brand";

type LegalPageLayoutProps = {
  title: string;
  updatedAt: string;
  description?: string;
  children: ReactNode;
};

export function LegalPageLayout({ title, updatedAt, description, children }: LegalPageLayoutProps) {
  return (
    <div className="public-shell public-site-theme min-h-screen overflow-x-hidden">
      <div className="public-grid-bg pointer-events-none fixed inset-0 opacity-35" aria-hidden="true" />
      <LandingHeader />

      <main className="relative mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="public-card p-6 sm:p-8">
          <p className="public-section-label">{APP_BRAND.name}</p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {description && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
          <p className="mt-3 text-xs text-muted-foreground">{"\u00daltima atualiza\u00e7\u00e3o"}: {updatedAt}</p>
        </header>
        <div className="public-card public-prose mt-5 p-6 sm:p-8">{children}</div>
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
