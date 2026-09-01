"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "./cn";

/**
 * Renders `children` only once the placeholder nears the viewport, so demos
 * below the fold cost nothing at load. The placeholder keeps the space.
 */
export function LazyMount({
  children,
  className,
  rootMargin = "400px 0px",
}: {
  children: ReactNode;
  /** Size the placeholder (e.g. `aspect-[16/10]`) to avoid layout shift. */
  className?: string;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || mounted) return;
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted, rootMargin]);

  if (mounted) return <>{children}</>;
  return <div ref={ref} aria-hidden className={cn("w-full", className)} />;
}
