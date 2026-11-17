import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

/** The element's content-box size, kept current with a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The element may mount after the hook does (behind a loading state).
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (ref.current !== element) setElement(ref.current);
  });
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/** Whether `ref` is the full-screen element, and a toggle for it. */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const update = () =>
      setActive(
        Boolean(ref.current) && document.fullscreenElement === ref.current,
      );
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [ref]);
  // Leaving the preview leaves full screen too.
  useEffect(
    () => () => {
      const element = ref.current;
      if (element && document.fullscreenElement === element) {
        void document.exitFullscreen?.().catch(() => {});
      }
    },
    [ref],
  );
  const supported =
    typeof document !== "undefined" && document.fullscreenEnabled === true;
  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    if (document.fullscreenElement === element) {
      void document.exitFullscreen?.().catch(() => {});
    } else {
      void element.requestFullscreen?.().catch(() => {});
    }
  }, [ref]);
  return { active, supported, toggle };
}

/** An object URL for `blob`, revoked when it changes or on unmount. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** True when the user asked for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
