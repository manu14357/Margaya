"use client";

import { useEffect, useRef } from "react";

/**
 * A hairline across the top of the viewport that fills as the reader moves
 * through the element with `targetId`. It writes the transform directly, so
 * scrolling never re-renders React.
 */
export function ReadingProgress({ targetId }: { targetId: string }) {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = document.getElementById(targetId);
    const element = bar.current;
    if (!target || !element) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = target.getBoundingClientRect();
      const distance = rect.height - window.innerHeight;
      const progress =
        distance <= 0 ? (rect.top <= 0 ? 1 : 0) : -rect.top / distance;
      element.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [targetId]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
    >
      <div className="h-full origin-left scale-x-0 bg-foreground" ref={bar} />
    </div>
  );
}
