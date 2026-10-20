// The output budget of a translation. Tokens per character depend on the
// target script: Latin text packs several characters into a token, while
// Devanagari and other Indic scripts often take one or more tokens per
// character. Too small a budget cuts the JSON answer off and the whole
// translation fails, so the estimate errs on the generous side; a model
// only spends what the translation needs.

/** Output tokens per source character, by the target's base language. */
const TOKENS_PER_CHAR: Record<string, number> = {
  // Indic, Thai, Lao, Khmer, Myanmar, Sinhala, Tibetan: byte-heavy scripts.
  hi: 1.6,
  mr: 1.6,
  ne: 1.6,
  bn: 1.6,
  pa: 1.6,
  gu: 1.6,
  or: 1.6,
  ta: 1.6,
  te: 1.6,
  kn: 1.6,
  ml: 1.6,
  si: 1.6,
  th: 1.4,
  lo: 1.4,
  km: 1.4,
  my: 1.6,
  bo: 1.6,
  // Georgian, Armenian, Amharic.
  ka: 1.2,
  hy: 1.2,
  am: 1.2,
  // CJK: few characters, each about a token.
  zh: 1,
  ja: 1,
  ko: 1,
  // Cyrillic, Greek, Arabic, Hebrew, Persian, Urdu.
  ru: 0.8,
  uk: 0.8,
  be: 0.8,
  bg: 0.8,
  mk: 0.8,
  sr: 0.8,
  kk: 0.8,
  el: 0.8,
  ar: 0.8,
  he: 0.8,
  fa: 0.8,
  ur: 0.8,
  // Latin with heavy diacritics.
  vi: 0.6,
};

/** Latin-script targets (English, German, Spanish, Turkish, …). */
const LATIN_TOKENS_PER_CHAR = 0.45;

/** JSON wrapper, source language and slack for an unusual tokenizer. */
const OVERHEAD_TOKENS = 1024;

/** The largest budget asked for (hosted models cap output near this). */
export const MAX_TRANSLATION_TOKENS = 32_000;

export function tokensPerChar(targetLocale: string): number {
  // The language part of the locale ("hi-IN" → "hi"), as in ./locale.
  const language = (targetLocale.split(/[-_]/)[0] ?? "").toLowerCase();
  return TOKENS_PER_CHAR[language] ?? LATIN_TOKENS_PER_CHAR;
}

/** maxTokens for translating `sourceChars` characters into `targetLocale`. */
export function translationMaxTokens(
  sourceChars: number,
  targetLocale: string,
): number {
  const estimate =
    Math.ceil(Math.max(0, sourceChars) * tokensPerChar(targetLocale)) +
    OVERHEAD_TOKENS;
  return Math.min(MAX_TRANSLATION_TOKENS, estimate);
}
