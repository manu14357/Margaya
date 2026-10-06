import { useCallback, useLayoutEffect, useState } from "react";

const DEFAULT_WIDTH = 320;

/**
 * The rendered size of an element, kept current with a ResizeObserver, so
 * SVG charts draw at real pixel size and their text never scales. Until the
 * element is measured (and in environments without layout, such as tests),
 * the width is `fallbackWidth` and the height 0.
 *
 * Attach `ref` to the element; it is a callback ref, so an element that
 * mounts later (after a loading state) is still observed.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>(
  fallbackWidth = DEFAULT_WIDTH,
) {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: fallbackWidth, height: 0 });
  const ref = useCallback((node: T | null) => setElement(node), []);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0) return;
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref, width: size.width, height: size.height };
}
