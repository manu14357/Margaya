import * as Sentry from "@sentry/react";

/** Loaded by instrument.ts only when a Sentry DSN is configured. */
export function initSentry(dsn: string) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: __APP_VERSION__,
    sendDefaultPii: false,
    ignoreErrors: [
      // Thrown by Safari browser extensions on iOS 18+ injecting content scripts;
      // not caused by margaya code.
      "Invalid call to runtime.sendMessage()",
      // Thrown by Facebook's in-app browser (Android) navigation performance logger
      // calling postMessage on a destroyed WebView Java bridge; not caused by margaya code.
      "Error invoking postMessage: Java object is gone",
    ],
    denyUrls: [
      // Errors from third-party affiliate/adware browser extensions that inject
      // scripts fetching from rsc.cdn77.org (e.g. domainList.json); not caused by margaya code.
      /cdn77\.org/,
    ],
    // Safari's "Load failed" used to be filtered here by message alone, which
    // also silenced actionable TanStack Query fetch failures. The query client
    // already rate-limits network errors via its own cooldown; auth-provider
    // tags its transient session-fetch errors so we can drop only those here.
    beforeSend(event) {
      if (event.tags?.area === "auth.session") return null;
      return event;
    },
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
