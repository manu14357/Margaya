import { useEffect, useState } from "react";

function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The app's resolved theme for the canvas. The theme provider sets the
 * `dark` class on <html> (system choice included), so the class is the
 * source of truth.
 */
export function useBoardTheme(): "light" | "dark" {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}
