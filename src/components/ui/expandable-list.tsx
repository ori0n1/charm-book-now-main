import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type ExpandableListProps<T> = {
  items: T[];
  initialCount?: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  className?: string;
  itemClassName?: string;
  buttonClassName?: string;
  buttonWrapClassName?: string;
  moreLabel?: (hiddenCount: number, total: number) => string;
  lessLabel?: string;
};

export function ExpandableList<T>({
  items,
  initialCount = 5,
  renderItem,
  getKey,
  className,
  itemClassName,
  buttonClassName,
  buttonWrapClassName,
  moreLabel,
  lessLabel = "Ver menos",
}: ExpandableListProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const limit = Math.max(1, initialCount);
  const hasMore = items.length > limit;
  const visibleItems = expanded || !hasMore ? items : items.slice(0, limit);
  const hiddenCount = Math.max(0, items.length - limit);

  return (
    <div className={cn("min-w-0", className)}>
      {visibleItems.map((item, index) => (
        <div key={getKey(item, index)} className={itemClassName}>
          {renderItem(item, index)}
        </div>
      ))}
      {hasMore && (
        <div
          className={cn(
            "col-span-full flex justify-center px-4 pb-4 pt-3 sm:px-5",
            buttonWrapClassName,
          )}
        >
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className={cn(
              "flex min-h-10 w-[85%] max-w-sm items-center justify-center rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-center text-xs font-semibold text-muted-foreground shadow-sm transition hover:border-foreground/15 hover:bg-muted hover:text-foreground active:scale-[0.99]",
              buttonClassName,
            )}
          >
            {expanded
              ? lessLabel
              : moreLabel?.(hiddenCount, items.length) ?? `Ver mais (${hiddenCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
