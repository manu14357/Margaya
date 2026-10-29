// One entry per app locale in i18n/, by language code. Every template's
// `messages` object must have all of them, so TypeScript flags a missing one.
export const emailLocales = [
  "en",
  "az",
  "de",
  "el",
  "es",
  "fr",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "mk",
  "nl",
  "pl",
  "pt",
  "ru",
  "tr",
  "uk",
  "vi",
  "zh",
] as const;

export type EmailLocale = (typeof emailLocales)[number];

const defaultLocale: EmailLocale = "en";

export function resolveEmailLocale(locale?: string | null): EmailLocale {
  if (!locale) return defaultLocale;

  const normalized = locale.toLowerCase();

  const exact = emailLocales.find((l) => l === normalized);
  if (exact) return exact;

  const languageCode = normalized.split("-")[0];
  const match = emailLocales.find((l) => l === languageCode);
  if (match) return match;

  return defaultLocale;
}
