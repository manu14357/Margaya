import { useEffect } from "react";

/**
 * Prints in the light theme: the dark class comes off the root just before
 * the browser lays the page out for print (its menu, Ctrl+P and
 * `window.print()` alike) and goes back right after.
 */
export function useLightThemeWhilePrinting() {
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      wasDark = root.classList.contains("dark");
      if (!wasDark) return;
      root.classList.remove("dark");
      root.classList.add("light");
    };
    const after = () => {
      if (!wasDark) return;
      wasDark = false;
      root.classList.remove("light");
      root.classList.add("dark");
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      after();
    };
  }, []);
}

/** Opens the browser's print dialog (where "Save as PDF" lives). */
export function printPage() {
  window.print();
}
