import { loadLocalePart } from "virtual:margaya-i18n";
import {
  type AppLocale,
  defaultLocale,
  isSupportedLocale,
  supportedLocales,
} from "@i18n/resources";
import i18n from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";
import {
  ChunkLoadError,
  reportChunkLoadFailure,
  retryChunk,
} from "@/lib/chunk-load";
import { LAZY_NAMESPACES } from "./lazy-namespaces";

function getLanguageCode(locale: string) {
  return locale.toLowerCase().split("-")[0];
}

export function resolveLocale(
  preferredLocale?: string | null,
  browserLocale?: string | null,
): AppLocale {
  const candidates = [preferredLocale, browserLocale].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();
    const exactMatch = supportedLocales.find(
      (locale) => locale.toLowerCase() === normalizedCandidate,
    );
    if (exactMatch) return exactMatch;

    const languageMatch = supportedLocales.find(
      (locale) => getLanguageCode(locale) === getLanguageCode(candidate),
    );
    if (languageMatch) return languageMatch;
  }

  return defaultLocale;
}

export function getBrowserLocale(): string | null {
  if (typeof navigator === "undefined") return null;
  return navigator.language || navigator.languages?.[0] || null;
}

// A signed-out visitor's language choice (from the public landing). A
// signed-in user's account locale always wins over it.
const GUEST_LOCALE_STORAGE_KEY = "margaya-locale";

export function getGuestLocale(): string | null {
  try {
    return localStorage.getItem(GUEST_LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setGuestLocale(locale: AppLocale) {
  try {
    localStorage.setItem(GUEST_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

/** The stored guest choice, else the browser's language. */
export function getPreferredGuestLocale(): string | null {
  return getGuestLocale() ?? getBrowserLocale();
}

// Components subscribe to the default namespace only, so any other namespace
// they reference through `t("ns:key")` must be preloaded after init and on
// every locale change. The core part of a locale holds every namespace but
// the lazy ones in one module, so cache it once per locale rather than import
// it again per namespace. A lazy namespace loads the first time i18next is
// asked for it (`i18n.loadNamespaces`, or `useTranslation` naming it).
const coreResources = new Map<AppLocale, Promise<Record<string, unknown>>>();

/**
 * One part of a locale, tried again when its chunk cannot be fetched. A part
 * that never loads asks for a reload: without it, keys show instead of text.
 */
function loadPart(locale: AppLocale, part: string) {
  const pending = retryChunk(() => loadLocalePart(locale, part));
  pending.catch((error: unknown) => {
    if (error instanceof ChunkLoadError) reportChunkLoadFailure();
  });
  return pending;
}
const lazyNamespaces: ReadonlySet<string> = new Set(LAZY_NAMESPACES);

function loadCoreResources(
  locale: AppLocale,
): Promise<Record<string, unknown>> {
  const cached = coreResources.get(locale);
  if (cached) return cached;
  const pending = loadPart(locale, "core").then((resources) => resources ?? {});
  // A failed load (a dropped connection) may be retried later.
  pending.catch(() => coreResources.delete(locale));
  coreResources.set(locale, pending);
  return pending;
}

export function preloadNamespaces(locale: AppLocale): Promise<void> {
  return loadCoreResources(locale).then((resources) =>
    i18n.loadNamespaces(Object.keys(resources)),
  );
}

const initialLocale = resolveLocale(getGuestLocale(), getBrowserLocale());

void i18n
  .use(
    resourcesToBackend((language: string, namespace: string) => {
      const locale = isSupportedLocale(language) ? language : defaultLocale;
      if (lazyNamespaces.has(namespace)) {
        return loadPart(locale, namespace);
      }
      return loadCoreResources(locale).then(
        (resources) => resources[namespace],
      );
    }),
  )
  .use(initReactI18next)
  .init({
    lng: initialLocale,
    fallbackLng: defaultLocale,
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
    },
    // Re-render on "loaded" too: a lazy namespace arriving updates every
    // component already showing its keys, not only the one that asked.
    react: {
      bindI18n: "languageChanged loaded",
    },
  })
  .then(() => preloadNamespaces(initialLocale));

export { i18n };
