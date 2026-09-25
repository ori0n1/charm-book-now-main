import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import { BellzaLogo, type BellzaLogoTone } from "@/components/bellza-logo";

export function LandingFooter({ brandTone = "auto" }: { brandTone?: BellzaLogoTone } = {}) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface-muted text-foreground">
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-8 sm:px-6 md:grid-cols-[1.35fr_1fr_1fr_1fr] md:gap-8 md:py-10">
        <div className="space-y-3 pb-2 md:space-y-4 md:pb-0">
          <BellzaLogo variant="footer" tone={brandTone} href={null} />
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{APP_BRAND.description}</p>
        </div>

        <FooterCol title="Produto">
          <FooterLink href="/#produto">Produto</FooterLink>
          <FooterLink href="/#como-funciona">Como funciona</FooterLink>
          <FooterLink href="/#funcionalidades">Funcionalidades</FooterLink>
          <FooterLink href="/#planos">Planos</FooterLink>
          <FooterLink href="/blog">Blog</FooterLink>
        </FooterCol>

        <FooterCol title="Conta">
          <FooterLink to="/signup">Criar conta</FooterLink>
          <FooterLink to="/login">Iniciar sessão</FooterLink>
          <FooterLink to="/contacto">Contacto</FooterLink>
        </FooterCol>

        <FooterCol title="Legal">
          <FooterLink to="/privacidade">Política de Privacidade</FooterLink>
          <FooterLink to="/cookies">Política de Cookies</FooterLink>
          <FooterLink to="/termos">Termos e Condições</FooterLink>
          <FooterLink to="/rgpd">RGPD/GDPR</FooterLink>
          <FooterLink to="/politica-reembolso">Reembolsos</FooterLink>
          <FooterLink to="/politica-cancelamento">Cancelamentos</FooterLink>
        </FooterCol>
      </div>

      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 border-t border-border px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        <p>© {year} {APP_BRAND.name}. Todos os direitos reservados.</p>
        <p>Portugal - RGPD - SSL - Pagamentos online através de fornecedores certificados</p>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group min-w-0 border-t border-border/70 pt-1 md:border-0 md:pt-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase text-muted-foreground marker:hidden md:hidden [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-base font-light transition-transform group-open:rotate-45" aria-hidden="true">+</span>
      </summary>
      <h2 className="hidden text-xs font-semibold uppercase text-muted-foreground md:block">{title}</h2>
      <ul className="hidden gap-2 pb-3 text-sm group-open:grid md:mt-3 md:grid md:pb-0">{children}</ul>
    </details>
  );
}

function FooterLink({ href, to, children }: { href?: string; to?: string; children: React.ReactNode }) {
  const className = "footer-link text-muted-foreground transition hover:text-foreground";
  if (to) {
    return (
      <li>
        <Link to={to} className={className}>
          {children}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <a href={href} className={className}>
        {children}
      </a>
    </li>
  );
}
