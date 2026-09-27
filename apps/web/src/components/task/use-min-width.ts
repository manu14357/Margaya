import { useCallback, useSyncExternalStore } from "react";

// jsdom and very old browsers have no matchMedia: treat them as wide.
const hasMatchMedia = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

/** Whether the viewport is at least `px` wide; follows resizes. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => !hasMatchMedia() || window.matchMedia(query).matches,
    () => true,
  );
}
