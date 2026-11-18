import { type PropsWithChildren, useEffect, useMemo } from "react";
import { I18nextProvider } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { loadDayPickerLocale } from "./day-picker-locale";
import {
  getPreferredGuestLocale,
  i18n,
  preloadNamespaces,
  resolveLocale,
} from "./index";

export function AppI18nProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();

  const resolvedLocale = useMemo(
    () => resolveLocale(user?.locale, getPreferredGuestLocale()),
    [user?.locale],
  );
  // The admin plugin's role; instance admins see instanceAdmin copy (the
  // settings menu, the update notice) outside the instance routes too.
  const isInstanceAdmin =
    (user as { role?: string | null } | null | undefined)?.role === "admin";

  useEffect(() => {
    void i18n
      .changeLanguage(resolvedLocale)
      .then(() => preloadNamespaces(resolvedLocale));
    // Ready before a date picker first opens, so it never flashes English.
    void loadDayPickerLocale(resolvedLocale);
    document.documentElement.lang = resolvedLocale;
  }, [resolvedLocale]);

  useEffect(() => {
    if (isInstanceAdmin) void i18n.loadNamespaces("instanceAdmin");
  }, [isInstanceAdmin]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
