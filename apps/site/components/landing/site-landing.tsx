"use client";

import {
  LANDING_LOCALES,
  type LandingPrefs,
  LandingProviders,
} from "@margaya/landing";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { landing } from "@/lib/landing";
import {
  DEFAULT_LOCALE,
  getLocaleState,
  getServerLocaleState,
  getServerTheme,
  getTheme,
  setLocale,
  setTheme,
  startLocale,
  subscribe,
} from "@/lib/landing-prefs";
import { siteLinks } from "@/lib/site-links";

/**
 * Copy, links and the visitor's preferences for the shared
 * `@margaya/landing` components. A client module on purpose: the copy ships
 * once in the shared JS chunk instead of being serialised into every page's
 * server payload.
 *
 * `localized` pages (the home page and the feature pages) follow the
 * visitor's language and offer the language controls. Every other page
 * (docs, blog, legal) has English content, so it stays English and offers
 * the theme only.
 */
export function SiteLandingProviders({
  children,
  localized = false,
}: {
  children: ReactNode;
  localized?: boolean;
}) {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const localeState = useSyncExternalStore(
    subscribe,
    getLocaleState,
    getServerLocaleState,
  );
  const locale = localized ? localeState.locale : DEFAULT_LOCALE;

  useEffect(() => {
    if (localized) void startLocale();
  }, [localized]);

  useEffect(() => {
    if (!localized) return;
    document.documentElement.lang = locale;
    return () => {
      document.documentElement.lang = "en";
    };
  }, [localized, locale]);

  const prefs = useMemo<LandingPrefs>(
    () => ({
      locale,
      locales: localized ? LANDING_LOCALES : [],
      setLocale: (code) => void setLocale(code),
      theme,
      setTheme,
    }),
    [locale, localized, theme],
  );

  return (
    <LandingProviders
      copy={localized ? localeState.copy : landing}
      links={siteLinks}
      prefs={prefs}
    >
      {children}
    </LandingProviders>
  );
}
