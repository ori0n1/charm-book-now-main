import { useEffect } from "react";

let activeLocks = 0;
let previous: { htmlOverflow: string; bodyOverflow: string; htmlOverscroll: string; bodyOverscroll: string } | null = null;

export function useModalScrollLock() {
  useEffect(() => {
    if (activeLocks++ === 0) {
      previous = {
        htmlOverflow: document.documentElement.style.overflow,
        bodyOverflow: document.body.style.overflow,
        htmlOverscroll: document.documentElement.style.overscrollBehavior,
        bodyOverscroll: document.body.style.overscrollBehavior,
      };
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.documentElement.style.overscrollBehavior = "none";
      document.body.style.overscrollBehavior = "none";
    }
    return () => {
      activeLocks = Math.max(0, activeLocks - 1);
      if (activeLocks === 0 && previous) {
        document.documentElement.style.overflow = previous.htmlOverflow;
        document.body.style.overflow = previous.bodyOverflow;
        document.documentElement.style.overscrollBehavior = previous.htmlOverscroll;
        document.body.style.overscrollBehavior = previous.bodyOverscroll;
        previous = null;
      }
    };
  }, []);
}

