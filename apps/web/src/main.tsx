import "./instrument";

import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import queryClient from "@/query-client";
import "@/index.css";
import "@/styles/editor.css";
import "@/styles/editor-blocks.css";
import "@/styles/semantic-colors.css";
import "@/styles/desktop.css";
import "./feature-registrations";
import "./lib/zod-locale";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { KeyboardShortcutsHelp } from "./components/keyboard-shortcuts-help";
import AuthProvider from "./components/providers/auth-provider";
import { ThemeProvider } from "./components/providers/theme-provider";
import { ErrorBoundary } from "./components/ui/error-boundary";
import {
  CrashFallback,
  NotFoundPage,
  RouteErrorPage,
} from "./components/ui/error-fallback";
import { KeyboardShortcutsProvider } from "./hooks/use-keyboard-shortcuts";
import { captureCheckoutIntent } from "./lib/checkout-intent";
import {
  installDesktopAppBehaviour,
  installDesktopExternalLinks,
  installDesktopNavigation,
} from "./lib/desktop";
import { AppI18nProvider } from "./lib/i18n/provider";
import { routeTree } from "./routeTree.gen";

// Capture a pricing-page `?checkout=<plan>-<interval>` deep link before the
// router runs and strips it across the sign-up → onboarding redirect chain.
captureCheckoutIntent();

// A no-op outside the desktop app.
installDesktopExternalLinks();

console.log("Margaya: plan the work, ship the work.");

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultNotFoundComponent: () => <NotFoundPage />,
  defaultErrorComponent: RouteErrorPage,
  context: {
    user: null,
    queryClient,
  },
});

// Desktop app only: its notifications and links navigate in place, and the
// window behaves like an app (no browser menus or keys, Ctrl/Cmd+, opens
// settings while signed in).
installDesktopNavigation((href) => {
  void router.navigate({ href });
});
installDesktopAppBehaviour({
  openSettings: () => {
    if (!router.state.location.pathname.startsWith("/dashboard")) return;
    void router.navigate({ to: "/dashboard/settings/account/information" });
  },
});

function App() {
  const { user } = useAuth();

  return <RouterProvider router={router} context={{ user }} />;
}

const rootElement = document.getElementById("root") as HTMLElement;
if (!rootElement.innerHTML) {
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ErrorBoundary fallback={CrashFallback}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AuthProvider>
              <AppI18nProvider>
                <KeyboardShortcutsProvider>
                  <App />
                  <KeyboardShortcutsHelp />
                </KeyboardShortcutsProvider>
              </AppI18nProvider>
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
