import { Link } from "@tanstack/react-router";
import { FaFacebookF, FaInstagram, FaTiktok, FaWhatsapp, FaXTwitter } from "react-icons/fa6";

type PublicFooterProps = {
  studioName?: string;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  x?: string | null;
  twitter?: string | null;
};

export function PublicFooter(props: PublicFooterProps) {
  const year = new Date().getFullYear();
  const links = buildSocialLinks(props);

  return (
    <footer className="border-t border-border bg-background/86 px-5 py-7 text-center backdrop-blur-xl">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 text-[11px] text-muted-foreground">
        {links.length > 0 && (
          <div className="mb-1 flex flex-wrap items-center justify-center gap-2">
            {links.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                className="grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/25 hover:text-foreground"
              >
                <Icon className="size-3.5" />
              </a>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link to="/privacidade" className="hover:text-foreground hover:underline">
            Política de Privacidade
          </Link>
          <span className="opacity-40">·</span>
          <Link to="/cookies" className="hover:text-foreground hover:underline">
            Política de Cookies
          </Link>
          <span className="opacity-40">·</span>
          <Link to="/termos" className="hover:text-foreground hover:underline">
            Termos
          </Link>
          <span className="opacity-40">·</span>
          <Link to="/politica-cancelamento" className="hover:text-foreground hover:underline">
            Cancelamento
          </Link>
          <span className="opacity-40">·</span>
          <Link to="/politica-reembolso" className="hover:text-foreground hover:underline">
            Reembolso
          </Link>
        </div>

        <p>
          © {year} {props.studioName ?? ""}
        </p>
      </div>
    </footer>
  );
}

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
