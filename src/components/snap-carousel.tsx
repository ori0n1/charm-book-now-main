import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export function SnapCarousel({
  children,
  labels,
  ariaLabel,
  initialIndex = 0,
  desktopGrid = false,
  variant = "content",
  className,
}: {
  children: ReactNode;
  labels: readonly string[];
  ariaLabel: string;
  initialIndex?: number;
  desktopGrid?: boolean;
  variant?: "plans" | "content";
  className?: string;
}) {
  const slides = Children.toArray(children);
  const safeInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(slides.length - 1, 0));
  const [activeIndex, setActiveIndex] = useState(safeInitialIndex);
  const railRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const animationFrame = useRef<number | null>(null);
  const hasCenteredWhenVisible = useRef(false);

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    const rail = railRef.current;
    const item = itemRefs.current[index];
    if (!rail || !item) return;
    const railBounds = rail.getBoundingClientRect();
    const itemBounds = item.getBoundingClientRect();
    const left = rail.scrollLeft
      + itemBounds.left
      - railBounds.left
      - (rail.clientWidth - itemBounds.width) / 2;
    rail.scrollTo({ left, behavior });
    setActiveIndex(index);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => scrollToIndex(safeInitialIndex, "auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [safeInitialIndex, scrollToIndex]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => scrollToIndex(activeIndex, "auto"));
    observer.observe(rail);
    return () => observer.disconnect();
  }, [activeIndex, scrollToIndex]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || hasCenteredWhenVisible.current) return;
      hasCenteredWhenVisible.current = true;
      scrollToIndex(activeIndex, "auto");
      observer.disconnect();
    }, { threshold: 0.05 });
    observer.observe(rail);
    return () => observer.disconnect();
  }, [activeIndex, scrollToIndex]);

  useEffect(() => () => {
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current);
  }, []);

  function updateActiveSlide() {
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current);
    animationFrame.current = window.requestAnimationFrame(() => {
      const rail = railRef.current;
      if (!rail) return;
      const railCenter = rail.scrollLeft + rail.clientWidth / 2;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      itemRefs.current.forEach((item, index) => {
        if (!item) return;
        const itemCenter = item.offsetLeft + item.clientWidth / 2;
        const distance = Math.abs(itemCenter - railCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      setActiveIndex(closestIndex);
      animationFrame.current = null;
    });
  }

  function handleKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    scrollToIndex(Math.min(Math.max(activeIndex + direction, 0), slides.length - 1));
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div
        ref={railRef}
        data-snap-carousel
        data-allow-viewport-bleed
        className={cn(
          "snap-carousel-rail flex w-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-4 pt-2",
          variant === "plans" ? "px-[6%]" : "px-[3%]",
          desktopGrid && "md:grid md:grid-cols-3 md:gap-3 md:overflow-visible md:px-0 md:pb-0 md:pt-0",
        )}
        role="region"
        aria-roledescription="carousel"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={updateActiveSlide}
        onKeyDown={handleKeyboard}
      >
        {slides.map((slide, index) => (
          <div
            key={labels[index] ?? index}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            data-snap-slide
            data-active={activeIndex === index ? "true" : "false"}
            className={cn(
              "min-w-0 shrink-0 snap-center transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
              activeIndex === index ? "scale-100 opacity-100" : "scale-[0.97] opacity-80",
              variant === "plans"
                ? "basis-[86%] max-w-[22rem]"
                : "basis-[94%] max-w-[42rem] sm:basis-[82%] md:basis-[54%] lg:basis-[48%]",
              desktopGrid && "md:max-w-none md:scale-100 md:opacity-100",
            )}
            role="group"
            aria-roledescription="slide"
            aria-label={`${labels[index] ?? `Item ${index + 1}`} — ${index + 1} de ${slides.length}`}
          >
            {slide}
          </div>
        ))}
      </div>

      <div
        className={cn("mt-1 flex items-center justify-center gap-2", desktopGrid && "md:hidden")}
        role="group"
        aria-label={`Navegar em ${ariaLabel.toLocaleLowerCase("pt-PT")}`}
      >
        {slides.map((_, index) => (
          <button
            key={labels[index] ?? index}
            type="button"
            aria-label={`Mostrar ${labels[index] ?? `item ${index + 1}`}`}
            aria-current={activeIndex === index ? "true" : undefined}
            onClick={() => scrollToIndex(index)}
            className={cn(
              "min-h-11 min-w-8 rounded-full p-0 transition-colors",
              "after:mx-auto after:block after:h-1.5 after:rounded-full after:transition-[width,background-color] after:duration-300",
              activeIndex === index
                ? "after:w-6 after:bg-foreground"
                : "after:w-1.5 after:bg-muted-foreground/35 hover:after:bg-muted-foreground/60",
            )}
          />
        ))}
      </div>
    </div>
  );
}
