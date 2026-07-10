import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { APP_BRAND } from "@/lib/app-brand";

const LOGO_SRC = "/bellza-logo.png";

const variantStyles = {
  navbar: {
    image: "size-10 shrink-0",
    wordmark: "text-[1.05rem] font-semibold tracking-[-0.02em]",
    gap: "gap-3",
  },
  footer: {
    image: "size-10 shrink-0",
    wordmark: "text-[1.05rem] font-semibold tracking-[-0.02em] text-inherit",
    gap: "gap-3",
  },
  mobile: {
    image: "size-8 shrink-0",
    wordmark: "text-base font-semibold tracking-tight",
    gap: "gap-2",
  },
  icon: {
    image: "size-8 shrink-0",
    wordmark: "sr-only",
    gap: "gap-0",
  },
} as const;

type BellzaLogoProps = {
  variant?: keyof typeof variantStyles;
  showWordmark?: boolean;
  className?: string;
  href?: string | null;
};

export function BellzaLogo({
  variant = "navbar",
  showWordmark = true,
  className,
  href = "/",
}: BellzaLogoProps) {
  const styles = variantStyles[variant];
  const content = (
    <>
      <img
        src={LOGO_SRC}
        alt={APP_BRAND.name}
        width={40}
        height={40}
        className={cn(styles.image, "rounded-full object-cover")}
        decoding="async"
      />
      {showWordmark && <span className={cn(styles.wordmark, "min-w-0 truncate")}>{APP_BRAND.name}</span>}
    </>
  );

  const rootClass = cn("inline-flex items-center", styles.gap, className);

  if (href) {
    return (
      <Link to={href} className={rootClass} aria-label={`${APP_BRAND.name} — início`}>
        {content}
      </Link>
    );
  }

  return <div className={rootClass}>{content}</div>;
}
