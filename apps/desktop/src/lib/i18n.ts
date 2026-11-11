import { createContext, useContext } from "react";

export type Copy = Record<string, unknown>;
export type CopyByLocale = Record<string, Copy>;
export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export const DEFAULT_LOCALE = "en-US";

/** Picks the best available locale: exact match first, then language only. */
export function resolveLocale(
  available: string[],
  preferred: readonly string[],
): string {
  for (const candidate of preferred) {
    const lower = candidate.toLowerCase();
    const exact = available.find((locale) => locale.toLowerCase() === lower);
    if (exact) return exact;
    const language = lower.split("-")[0];
    const sameLanguage = available.find(
      (locale) => locale.toLowerCase().split("-")[0] === language,
    );
    if (sameLanguage) return sameLanguage;
  }
  return DEFAULT_LOCALE;
}

function lookup(copy: Copy | undefined, key: string): string | undefined {
  let node: unknown = copy;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(
  text: string,
  values: Record<string, string | number> | undefined,
) {
  if (!values) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * A translator over the `desktop.launcher` copy. Keys are relative to that
 * namespace ("servers.open"). A `count` value selects a plural form
 * (`_one`, `_other`, ...) with the locale's own rules. Missing keys fall back
 * to English, then to the key itself.
 */
export function createTranslator(
  copyByLocale: CopyByLocale,
  locale: string,
): Translate {
  const primary = copyByLocale[locale];
  const fallback = copyByLocale[DEFAULT_LOCALE];
  const plurals = new Intl.PluralRules(locale);
  const find = (key: string) => lookup(primary, key) ?? lookup(fallback, key);
  return (key, values) => {
    let text: string | undefined;
    if (values && typeof values.count === "number") {
      text =
        find(`${key}_${plurals.select(values.count)}`) ?? find(`${key}_other`);
    }
    text ??= find(key);
    return interpolate(text ?? key, values);
  };
}

export const I18nContext = createContext<Translate>((key) => key);

export function useT(): Translate {
  return useContext(I18nContext);
}
