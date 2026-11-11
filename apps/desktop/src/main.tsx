import copyByLocale from "virtual:desktop-i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Launcher } from "./launcher";
import { createTranslator, I18nContext, resolveLocale } from "./lib/i18n";
import { Offline } from "./offline";
import { QuickAdd } from "./quick-add";
import "./styles.css";

const locale = resolveLocale(
  Object.keys(copyByLocale),
  navigator.languages ?? [navigator.language],
);
document.documentElement.lang = locale;
const t = createTranslator(copyByLocale, locale);

// One bundle serves three pages: the launcher, the quick-add window that the
// Rust core opens at index.html#quick-add or #quick-add=<serverId>, and the
// offline page it shows inside a server window at index.html#offline.
const hash = window.location.hash.slice(1);
const offline = hash === "offline";
const quickAdd = hash.startsWith("quick-add");
const quickAddServer = hash.startsWith("quick-add=")
  ? decodeURIComponent(hash.slice("quick-add=".length))
  : null;

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nContext.Provider value={t}>
        {offline ? (
          <Offline />
        ) : quickAdd ? (
          <QuickAdd initialServerId={quickAddServer} />
        ) : (
          <Launcher />
        )}
      </I18nContext.Provider>
    </StrictMode>,
  );
}
