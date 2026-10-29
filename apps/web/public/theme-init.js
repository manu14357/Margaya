// Applies the saved theme to <html> before the first paint, so a dark or
// high-contrast choice does not flash light while the app loads. It reads the
// theme store's persisted copy (src/store/user-preferences.ts), which the
// server preference sync also writes, and mirrors themeClasses() in
// src/components/providers/theme-provider; theme-init.test.ts keeps the two
// in step. It is a file rather than an inline script because the page
// content policy (script-src 'self') blocks inline scripts.
(() => {
  let theme = "light";
  try {
    const saved = JSON.parse(
      localStorage.getItem("user-preferences") || "null",
    );
    if (saved?.state && typeof saved.state.theme === "string") {
      theme = saved.state.theme;
    }
  } catch {}

  let prefersDark = false;
  try {
    prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {}

  const dark =
    theme === "dark" ||
    theme === "dark-contrast" ||
    (theme === "system" && prefersDark);
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(dark ? "dark" : "light");
  root.classList.toggle(
    "contrast",
    theme === "light-contrast" || theme === "dark-contrast",
  );
})();
