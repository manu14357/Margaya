import copyByLocale from "virtual:desktop-i18n";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Launcher } from "./launcher";
import { createTranslator, I18nContext, resolveLocale } from "./lib/i18n";
import { Offline } from "./offline";
import { QuickAdd } from "./quick-add";
import { Search } from "./search";
import { Today } from "./today";
import "./styles.css";

// The Files window carries the shared preview's renderers (PDF, Office,
// code, 3D); only that window loads them.
const Files = lazy(() =>
  import("./files").then((module) => ({ default: module.Files })),
);

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
// Global search (#search) and the Today mini window (#today).
const search = hash === "search";
const today = hash === "today";
// The Files window (#files).
const files = hash === "files";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nContext.Provider value={t}>
        {offline ? (
          <Offline />
        ) : quickAdd ? (
          <QuickAdd initialServerId={quickAddServer} />
        ) : search ? (
          <Search />
        ) : today ? (
          <Today />
        ) : files ? (
          <Suspense fallback={null}>
            <Files />
          </Suspense>
        ) : (
          <Launcher />
        )}
      </I18nContext.Provider>
    </StrictMode>,
  );
}
