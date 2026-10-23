import type { LandingTheme } from "@margaya/landing";

/**
 * The visitor's theme choice: "light", "dark" or "system". Unset means light:
 * the site only follows the OS setting once the visitor picks "system".
 */
export const THEME_STORAGE_KEY = "margaya-site-theme";

export function isLandingTheme(value: unknown): value is LandingTheme {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Runs in the document before hydration, so the stored theme applies
 * without a flash. It follows the OS setting only while the choice is
 * "system"; unset stays light. `applyTheme` below must match it.
 */
export const themeScript = `(function () {
  try {
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var apply = function () {
      var stored = null;
      try { stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}); } catch (e) {}
      var dark = stored === "dark" || (stored === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    if (media.addEventListener) media.addEventListener("change", apply);
    else if (media.addListener) media.addListener(apply);
  } catch (e) {}
})();`;

export function applyTheme(theme: LandingTheme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}
