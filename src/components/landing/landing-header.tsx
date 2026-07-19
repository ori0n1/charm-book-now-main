import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { BellzaLogo } from "@/components/bellza-logo";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/#como-funciona", label: "Como funciona" },
  { href: "/#funcionalidades", label: "Funcionalidades" },
  { href: "/#produto", label: "Produto" },
  { href: "/#planos", label: "Planos" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function LandingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="public-nav">
      <nav
        className="relative mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6"
        aria-label="Principal"
      >
        <BellzaLogo variant="navbar" className="min-w-0 shrink" />

        <div className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="public-btn-ghost px-3">
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <Link to="/login" className="public-btn-ghost hidden sm:inline-flex">
            Entrar
          </Link>
          <Link
            to="/signup"
            search={{ ref: undefined }}
            className="public-btn-primary hidden h-10 px-4 text-sm sm:inline-flex"
          >
            Começar grátis
          </Link>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full border border-border/70 bg-card/90 shadow-sm lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="landing-mobile-nav"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span className="sr-only">{mobileOpen ? "Fechar menu" : "Abrir menu"}</span>
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </nav>

      <div
        id="landing-mobile-nav"
        className={cn(
          "border-t border-border/60 bg-background/96 px-4 pb-4 shadow-lg backdrop-blur-xl lg:hidden",
          mobileOpen ? "block" : "hidden",
        )}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-1 pt-3">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="min-h-11 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <Link
            to="/login"
            onClick={() => setMobileOpen(false)}
            className="min-h-11 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground"
          >
            Entrar
          </Link>
          <Link
            to="/signup"
            search={{ ref: undefined }}
            onClick={() => setMobileOpen(false)}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-foreground px-3 py-2.5 text-sm font-semibold text-background"
          >
            Começar 14 dias grátis
          </Link>
        </div>
      </div>
    </header>
  );
}
