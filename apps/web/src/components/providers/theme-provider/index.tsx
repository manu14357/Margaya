import { useEffect } from "react";
import { type Theme, useUserPreferencesStore } from "@/store/user-preferences";

/**
 * The classes a theme puts on <html>. The high-contrast themes keep the
 * `light`/`dark` class (code blocks, diagrams and print read it) and add
 * `contrast`, which swaps in the stronger token set.
 */
export function themeClasses(
  theme: Theme,
  prefersDark: boolean,
): { mode: "light" | "dark"; contrast: boolean } {
  switch (theme) {
    case "system":
      return { mode: prefersDark ? "dark" : "light", contrast: false };
    case "light-contrast":
      return { mode: "light", contrast: true };
    case "dark-contrast":
      return { mode: "dark", contrast: true };
    default:
      return { mode: theme, contrast: false };
  }
}

function applyTheme(theme: Theme, prefersDark: boolean) {
  const root = document.documentElement;
  const { mode, contrast } = themeClasses(theme, prefersDark);
  root.classList.remove("light", "dark");
  root.classList.add(mode);
  root.classList.toggle("contrast", contrast);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useUserPreferencesStore();

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(theme, mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === "system") applyTheme(theme, e.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  return <>{children}</>;
}
