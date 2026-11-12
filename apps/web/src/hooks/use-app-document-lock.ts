import { useEffect } from "react";

/**
 * While mounted, the document is an app frame rather than a page: it never
 * scrolls, rubber-bands or swipes through history, and only the panes
 * inside scroll (`html[data-app-shell]` in index.css). Mounted by the app
 * shell; public and sign-in pages keep ordinary page behaviour.
 */
export function useAppDocumentLock() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.appShell = "";
    return () => {
      delete root.dataset.appShell;
    };
  }, []);
}
