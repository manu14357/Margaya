import {
  LANDING_LOCALES,
  type LandingCopy,
  type LandingTheme,
  mergeLandingCopy,
} from "@margaya/landing";
import { landing as englishCopy } from "./landing";
import { applyTheme, isLandingTheme, THEME_STORAGE_KEY } from "./landing-theme";

// The visitor's language and theme on the public site. The pages are
// exported as English HTML (that is what search engines index); a chosen
// language is applied in the browser by fetching that locale's `landing`
// bundle from /landing-copy/<locale>.json and laying it over English.

export const DEFAULT_LOCALE = "en-US";
export const LOCALE_STORAGE_KEY = "margaya-site-locale";

export type LocaleState = { locale: string; copy: LandingCopy };

const ENGLISH: LocaleState = { locale: DEFAULT_LOCALE, copy: englishCopy };

let localeState: LocaleState = ENGLISH;
let theme: LandingTheme | null = null;
let started = false;
let requested = DEFAULT_LOCALE;
const bundles = new Map<string, Promise<LandingCopy>>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Matches a browser language to a supported locale: exact, then by language. */
export function resolveLocale(
  candidates: readonly (string | null | undefined)[],
): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    const exact = LANDING_LOCALES.find(
      (locale) => locale.code.toLowerCase() === lower,
    );
    if (exact) return exact.code;
    const language = lower.split("-")[0];
    const partial = LANDING_LOCALES.find(
      (locale) => locale.code.toLowerCase().split("-")[0] === language,
    );
    if (partial) return partial.code;
  }
  return null;
}

function loadCopy(locale: string): Promise<LandingCopy> {
  if (locale === DEFAULT_LOCALE) return Promise.resolve(englishCopy);
  let pending = bundles.get(locale);
  if (!pending) {
    pending = fetch(`/landing-copy/${locale}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((translated) => mergeLandingCopy(englishCopy, translated));
    // A failed load can be retried by picking the language again.
    pending.catch(() => bundles.delete(locale));
    bundles.set(locale, pending);
  }
  return pending;
}

function switchTo(locale: string) {
  requested = locale;
  return loadCopy(locale).then(
    (copy) => {
      // A later pick wins over a slower earlier one.
      if (requested !== locale) return;
      localeState = { locale, copy };
      emit();
    },
    () => {
      // Keep the current language when a bundle cannot be loaded.
      if (requested === locale) requested = localeState.locale;
    },
  );
}

export function getLocaleState(): LocaleState {
  return localeState;
}

export function getServerLocaleState(): LocaleState {
  return ENGLISH;
}

/**
 * Applies the stored language, or on a first visit the browser's language
 * when the site has it. Runs once, when a localized page first mounts.
 */
export function startLocale(): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  const stored = resolveLocale([readStorage(LOCALE_STORAGE_KEY)]);
  const initial =
    stored ??
    resolveLocale([...(navigator.languages ?? []), navigator.language]) ??
    DEFAULT_LOCALE;
  return initial === localeState.locale ? Promise.resolve() : switchTo(initial);
}

export function setLocale(locale: string): Promise<void> {
  const resolved = resolveLocale([locale]) ?? DEFAULT_LOCALE;
  started = true;
  writeStorage(LOCALE_STORAGE_KEY, resolved);
  return switchTo(resolved);
}

export function getTheme(): LandingTheme {
  if (theme === null) {
    const stored = readStorage(THEME_STORAGE_KEY);
    theme = isLandingTheme(stored) ? stored : "system";
  }
  return theme;
}

export function getServerTheme(): LandingTheme {
  return "system";
}

export function setTheme(next: LandingTheme) {
  theme = next;
  writeStorage(THEME_STORAGE_KEY, next);
  applyTheme(next);
  emit();
}

/** Test-only: forget every choice and cached bundle. */
export function resetLandingPrefs() {
  localeState = ENGLISH;
  theme = null;
  started = false;
  requested = DEFAULT_LOCALE;
  bundles.clear();
  listeners.clear();
}
