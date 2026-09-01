"use client";

import { createContext, type ReactNode, useContext } from "react";

export type LandingTheme = "light" | "dark" | "system";

export const LANDING_THEMES: readonly LandingTheme[] = [
  "light",
  "dark",
  "system",
];

/** A language the visitor can pick, named in its own language. */
export type LandingLocale = { code: string; nativeName: string };

/**
 * Every locale in `i18n/`, by its endonym. Endonyms are the same in every
 * language, so they are data rather than copy.
 */
export const LANDING_LOCALES: readonly LandingLocale[] = [
  { code: "en-US", nativeName: "English" },
  { code: "az-AZ", nativeName: "Azərbaycanca" },
  { code: "de-DE", nativeName: "Deutsch" },
  { code: "el-GR", nativeName: "Ελληνικά" },
  { code: "es-ES", nativeName: "Español" },
  { code: "fr-FR", nativeName: "Français" },
  { code: "hi-IN", nativeName: "हिन्दी" },
  { code: "id-ID", nativeName: "Bahasa Indonesia" },
  { code: "it-IT", nativeName: "Italiano" },
  { code: "ja-JP", nativeName: "日本語" },
  { code: "ko-KR", nativeName: "한국어" },
  { code: "mk-MK", nativeName: "Македонски" },
  { code: "nl-NL", nativeName: "Nederlands" },
  { code: "pl-PL", nativeName: "Polski" },
  { code: "pt-BR", nativeName: "Português (Brasil)" },
  { code: "ru-RU", nativeName: "Русский" },
  { code: "tr-TR", nativeName: "Türkçe" },
  { code: "uk-UA", nativeName: "Українська" },
  { code: "vi-VN", nativeName: "Tiếng Việt" },
  { code: "zh-CN", nativeName: "简体中文" },
];

/**
 * The visitor's language and theme, owned by the host app. The navbar and
 * footer render their language and theme controls only when a host
 * provides this; the language controls also need at least two `locales`.
 */
export type LandingPrefs = {
  locale: string;
  locales: readonly LandingLocale[];
  setLocale: (code: string) => void;
  theme: LandingTheme;
  setTheme: (theme: LandingTheme) => void;
};

const LandingPrefsContext = createContext<LandingPrefs | null>(null);

export function LandingPrefsProvider({
  prefs,
  children,
}: {
  prefs: LandingPrefs;
  children: ReactNode;
}) {
  return (
    <LandingPrefsContext.Provider value={prefs}>
      {children}
    </LandingPrefsContext.Provider>
  );
}

/** The host's preferences, or null when it provides none. */
export function useLandingPrefs(): LandingPrefs | null {
  return useContext(LandingPrefsContext);
}

/** Whether the language controls have anything to offer. */
export function hasLanguageChoice(prefs: LandingPrefs | null): boolean {
  return Boolean(prefs && prefs.locales.length > 1);
}
