import { Link } from "@tanstack/react-router";
import { FaFacebookF, FaInstagram, FaTiktok, FaWhatsapp, FaXTwitter } from "react-icons/fa6";

type PublicFooterProps = {
  /** Kept for API compatibility but no longer rendered — studio name was removed from footer */
  studioName?: string;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  x?: string | null;
  twitter?: string | null;
};

const LEGAL = [
  { to: "/privacidade",          label: "Privacidade"   },
  { to: "/cookies",              label: "Cookies"       },
  { to: "/termos",               label: "Termos"        },
  { to: "/politica-cancelamento",label: "Cancelamento"  },
  { to: "/politica-reembolso",   label: "Reembolso"     },
] as const;

export function PublicFooter(props: PublicFooterProps) {
  const year  = new Date().getFullYear();
  const links = buildSocialLinks(props);

  return (
    <footer
      aria-label="Rodapé"
      className="mt-auto border-t border-border/30 bg-muted/25 backdrop-blur-xl"
    >
      {/* Unified centered layout — desktop & mobile */}
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-5">

        {/* Row 1 — Social icons (hidden when studio has none) */}
        {links.length > 0 && (
          <div className="flex items-center gap-2">
            {links.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                className="grid size-8 place-items-center rounded-full border border-border/50 bg-background text-muted-foreground/55 shadow-sm transition-all hover:border-foreground/20 hover:bg-card hover:text-foreground hover:shadow"
              >
                <Icon className="size-3" />
              </a>
            ))}
          </div>
        )}

        {/* Row 2 — Legal links */}
        <nav
          aria-label="Links legais"
          className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1"
        >
          {LEGAL.map(({ to, label }, i) => (
            <span key={to} className="flex items-center gap-1">
              {i > 0 && <Dot />}
              <Link
                to={to}
                className="whitespace-nowrap text-[11px] text-muted-foreground/55 transition hover:text-foreground hover:underline"
              >
                {label}
              </Link>
            </span>
          ))}
        </nav>

        {/* Row 3 — Copyright */}
        <span className="text-[11px] tabular-nums text-muted-foreground/35">
          © {year}
        </span>
        <span className="max-w-full whitespace-normal text-center text-[11px] text-muted-foreground/35 sm:whitespace-nowrap">
          Bellza.
        </span>

      </div>
    </footer>
  );
}

/* ── Separator dot ─────────────────────────────────────── */
function Dot() {
  return (
    <span aria-hidden="true" className="select-none text-muted-foreground/30">
      ·
    </span>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildSocialLinks({
  phone,
  whatsapp,
  instagram,
  facebook,
  tiktok,
  x,
  twitter,
}: PublicFooterProps) {
  const wa = cleanPhone(whatsapp || phone);
  return [
    wa && { label: "WhatsApp", href: `https://wa.me/${wa}`, icon: FaWhatsapp },
    getInstagramHref(instagram) && {
      label: "Instagram",
      href: getInstagramHref(instagram)!,
      icon: FaInstagram,
    },
    getSocialHref(facebook, "https://www.facebook.com/") && {
      label: "Facebook",
      href: getSocialHref(facebook, "https://www.facebook.com/")!,
      icon: FaFacebookF,
    },
    getSocialHref(tiktok, "https://www.tiktok.com/@") && {
      label: "TikTok",
      href: getSocialHref(tiktok, "https://www.tiktok.com/@")!,
      icon: FaTiktok,
    },
    getSocialHref(twitter || x, "https://x.com/") && {
      label: "X",
      href: getSocialHref(twitter || x, "https://x.com/")!,
      icon: FaXTwitter,
    },
  ].filter(Boolean) as { label: string; href: string; icon: typeof FaWhatsapp }[];
}

function cleanPhone(value?: string | null) {
  return (value ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "");
}

function getInstagramHref(value?: string | null) {
  const input = (value ?? "").trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) return input;
  return `https://www.instagram.com/${input.replace(/^@/, "")}`;
}

function getSocialHref(value: string | null | undefined, base: string) {
  const input = (value ?? "").trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) return input;
  return `${base}${input.replace(/^@/, "")}`;
}
