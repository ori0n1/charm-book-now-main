import * as React from "react";

import { cn } from "@/lib/utils";

const responsiveSurface =
  "min-w-0 max-w-full overflow-hidden border border-border/80 bg-card text-card-foreground shadow-sm";
const responsiveText = "min-w-0 max-w-full overflow-hidden text-ellipsis break-words";
const responsiveControl =
  "min-w-0 max-w-full touch-manipulation whitespace-normal break-words text-center leading-tight";

const ResponsivePage = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bellza-responsive-page min-h-dvh w-full max-w-full overflow-x-hidden px-4 pb-safe-8 pt-safe-4 sm:px-6",
        className,
      )}
      {...props}
    />
  ),
);
ResponsivePage.displayName = "ResponsivePage";

const ResponsiveCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(responsiveSurface, "rounded-responsive p-4 sm:p-5", className)}
      {...props}
    />
  ),
);
ResponsiveCard.displayName = "ResponsiveCard";

const ResponsiveList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("grid min-w-0 max-w-full gap-3 overflow-hidden", className)}
      {...props}
    />
  ),
);
ResponsiveList.displayName = "ResponsiveList";

const ResponsiveHeader = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <header
      ref={ref}
      className={cn("min-w-0 max-w-full overflow-hidden px-4 py-3 sm:px-6", className)}
      {...props}
    />
  ),
);
ResponsiveHeader.displayName = "ResponsiveHeader";

const ResponsiveModalPanel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        responsiveSurface,
        "max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-1rem)] w-[min(calc(100vw-1rem),36rem)] rounded-responsive overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
);
ResponsiveModalPanel.displayName = "ResponsiveModalPanel";

const ResponsiveFixedFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-fixed-footer
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 max-w-full border-t border-border bg-background/95 px-4 pb-safe-3 pt-3 backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  ),
);
ResponsiveFixedFooter.displayName = "ResponsiveFixedFooter";

export {
  ResponsiveCard,
  ResponsiveFixedFooter,
  ResponsiveHeader,
  ResponsiveList,
  ResponsiveModalPanel,
  ResponsivePage,
  responsiveControl,
  responsiveSurface,
  responsiveText,
};
