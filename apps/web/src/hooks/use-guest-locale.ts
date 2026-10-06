import { isSupportedLocale } from "@i18n/resources";
import { LANDING_LOCALES } from "@margaya/landing";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { resolveLocale, setGuestLocale } from "@/lib/i18n";

/** Every app locale, named in its own language. */
export const GUEST_LOCALES = LANDING_LOCALES.filter((locale) =>
  isSupportedLocale(locale.code),
);

/**
 * The interface language for signed-out screens (the landing and the auth
 * pages). The choice is stored in the browser, and the app keeps using it
 * after sign-in until the account has a language of its own.
 */
export function useGuestLocale() {
  const { i18n } = useTranslation();
  const locale = resolveLocale(i18n.resolvedLanguage ?? i18n.language, null);

  const setLocale = useCallback(
    async (code: string) => {
      const next = resolveLocale(code, null);
      setGuestLocale(next);
      // Load every namespace first, so the page swaps language in place
      // instead of suspending.
      await i18n.loadLanguages(next);
      await i18n.changeLanguage(next);
      document.documentElement.lang = next;
    },
    [i18n],
  );

  return { locale, locales: GUEST_LOCALES, setLocale };
}
