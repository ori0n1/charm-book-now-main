import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import { BellzaLogo } from "@/components/bellza-logo";

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface-muted text-foreground">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.35fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <BellzaLogo variant="navbar" href={null} />
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
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h2>
      <ul className="grid gap-2 text-sm">{children}</ul>
    </div>
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
