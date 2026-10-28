import { BellzaLogo, type BellzaLogoTone } from "@/components/bellza-logo";
import { cn } from "@/lib/utils";

type BrandLoadingStateProps = {
  label?: string;
  tone?: BellzaLogoTone;
  fullScreen?: boolean;
  className?: string;
};

export function BrandLoadingState({
  label = "A carregar...",
  tone = "auto",
  fullScreen = false,
  className,
}: BrandLoadingStateProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 px-6 text-center",
        fullScreen ? "min-h-screen" : "min-h-40",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative">
        <BellzaLogo
          variant="icon"
          showWordmark={false}
          tone={tone}
          className="size-10 motion-safe:animate-pulse"
          href={null}
        />
        <span
          className="absolute -bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-accent motion-safe:animate-pulse"
          aria-hidden="true"
        />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
