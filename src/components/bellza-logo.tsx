import { Link } from "@tanstack/react-router";
import { APP_BRAND } from "@/lib/app-brand";
import {
  BELLZA_LOGO,
  BELLZA_LOGO_WHITE,
  BELLZA_SYMBOL,
  BELLZA_SYMBOL_WHITE,
} from "@/lib/brand-assets";
import { cn } from "@/lib/utils";

const BRAND_ASSETS = {
  logo: {
    light: BELLZA_LOGO,
    dark: BELLZA_LOGO_WHITE,
  },
  symbol: {
    light: BELLZA_SYMBOL,
    dark: BELLZA_SYMBOL_WHITE,
  },
} as const;

const variantStyles = {
  navbar: "h-10 w-40",
  footer: "h-10 w-40",
  mobile: "h-8 w-32",
  icon: "size-8",
} as const;

export type BellzaLogoTone = "auto" | "light" | "dark";

type BellzaLogoProps = {
  variant?: keyof typeof variantStyles;
  showWordmark?: boolean;
  tone?: BellzaLogoTone;
  className?: string;
  href?: string | null;
};

export function BellzaLogo({
  variant = "navbar",
  showWordmark = true,
  tone = "auto",
  className,
  href = "/",
}: BellzaLogoProps) {
  const symbolOnly = variant === "icon" || !showWordmark;
  const assets = symbolOnly ? BRAND_ASSETS.symbol : BRAND_ASSETS.logo;
  const imageClass = cn(
    "block h-full w-full object-contain",
    symbolOnly ? "object-center" : "object-left",
  );

  const renderImage = (src: string) => (
    <img
      src={src}
      alt={APP_BRAND.name}
      width={symbolOnly ? 128 : 720}
      height={symbolOnly ? 128 : 180}
      className={imageClass}
      decoding="async"
    />
  );

  const content =
    tone === "auto" ? (
      <>
        <span className="block h-full w-full dark:hidden">{renderImage(assets.light)}</span>
        <span className="hidden h-full w-full dark:block">{renderImage(assets.dark)}</span>
      </>
    ) : (
      renderImage(assets[tone])
    );

  const rootClass = cn(
    "inline-flex shrink-0 items-center overflow-hidden",
    variantStyles[variant],
    className,
  );
  const label = href ? `${APP_BRAND.name} — início` : APP_BRAND.name;

  if (href) {
    return (
      <Link to={href} className={rootClass} aria-label={label}>
        {content}
      </Link>
    );
  }

  return (
    <div className={rootClass} role="img" aria-label={label}>
      {content}
    </div>
  );
}
