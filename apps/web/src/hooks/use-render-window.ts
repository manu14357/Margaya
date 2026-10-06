import { useCallback, useEffect, useState } from "react";

/** Cards or rows a board column or list group mounts before scrolling. */
export const RENDER_WINDOW_STEP = 60;

/**
 * Mounts a long list in steps: the first `step` items, then `step` more each
 * time the sentinel (placed after the last mounted item) comes within 400px
 * of view. A 5,000-task board mounted every card up front, which blocked the
 * main thread for seconds and held hundreds of megabytes. Without
 * IntersectionObserver everything is mounted, as before.
 */
export function useRenderWindow(total: number, step = RENDER_WINDOW_STEP) {
  const [limit, setLimit] = useState(step);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const supported = typeof IntersectionObserver !== "undefined";
  const count = supported ? Math.min(total, limit) : total;
  const hasMore = count < total;

  // Re-observing after each step reports the sentinel's state afresh, so a
  // sentinel that is still in view after a step asks for the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: count re-arms the observer
  useEffect(() => {
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLimit((current) => current + step);
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, step, count]);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    setSentinel(node);
  }, []);

  return { count, hasMore, sentinelRef };
}
