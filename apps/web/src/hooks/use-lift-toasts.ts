import { useLayoutEffect } from "react";

export const TOAST_LIFT_VAR = "--toast-lift";

/**
 * While `element` (a bar pinned to the bottom of the screen, such as the bulk
 * selection bar) is shown, bottom toasts sit above it instead of covering its
 * buttons. Pass the element from a callback ref; null lets the toasts drop.
 */
export function useLiftToasts(element: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!element) return;
    const root = document.documentElement;
    const update = () => {
      const { top } = element.getBoundingClientRect();
      const lift = Math.max(0, Math.round(window.innerHeight - top));
      root.style.setProperty(TOAST_LIFT_VAR, `${lift}px`);
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(TOAST_LIFT_VAR);
    };
  }, [element]);
}
