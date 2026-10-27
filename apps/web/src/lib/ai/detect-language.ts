// A cheap, offline language guess for translate-on-read: it decides whether
// to offer "Translate" at all, so the model is only asked when the text is
// likely in another language than the reader's. Script first (Cyrillic,
// Greek, CJK, ...), then common words and letters for Latin-script text.
// It answers null rather than guess: short or mixed text gets no offer.

/** Fewer letters than this is too little to judge. */
const MIN_LETTERS = 12;
/** Unknown Latin text in a Latin-script UI is not offered below this. */
const UNKNOWN_OFFER_LETTERS = 40;

const STOPWORDS: Record<string, readonly string[]> = {
  en: [
    "the",
    "and",
    "is",
    "are",
    "was",
    "to",
    "of",
    "it",
    "this",
    "that",
    "with",
    "for",
    "not",
    "be",
    "have",
    "you",
    "we",
    "should",
    "can",
    "when",
    "but",
    "from",
    "will",
    "please",
    "after",
    "there",
  ],
  de: [
    "der",
    "die",
    "das",
    "und",
    "ist",
    "nicht",
    "ein",
    "eine",
    "mit",
    "auf",
    "für",
    "ich",
    "wir",
    "sie",
    "es",
    "zu",
    "den",
    "dem",
    "von",
    "auch",
    "bei",
    "wird",
    "sind",
    "noch",
    "kann",
    "bitte",
    "nach",
    "wenn",
  ],
  es: [
    "el",
    "la",
    "los",
    "las",
    "que",
    "y",
    "es",
    "un",
    "una",
    "por",
    "para",
    "con",
    "no",
    "se",
    "del",
    "al",
    "lo",
    "como",
    "pero",
    "está",
    "son",
    "muy",
    "cuando",
    "hay",
    "esto",
  ],
  fr: [
    "le",
    "la",
    "les",
    "et",
    "est",
    "un",
    "une",
    "des",
    "du",
    "que",
    "qui",
    "pour",
    "pas",
    "dans",
    "ce",
    "il",
    "nous",
    "vous",
    "sur",
    "avec",
    "mais",
    "sont",
    "je",
    "ne",
    "cette",
  ],
  it: [
    "il",
    "la",
    "che",
    "e",
    "è",
    "di",
    "un",
    "una",
    "per",
    "non",
    "con",
    "del",
    "della",
    "sono",
    "gli",
    "nel",
    "ma",
    "anche",
    "questo",
    "quando",
    "ci",
    "si",
    "funziona",
  ],
  nl: [
    "de",
    "het",
    "een",
    "en",
    "is",
    "van",
    "niet",
    "dat",
    "met",
    "voor",
    "op",
    "ik",
    "we",
    "zijn",
    "ook",
    "maar",
    "er",
    "wordt",
    "nog",
    "kan",
    "als",
    "deze",
    "werkt",
  ],
  pl: [
    "i",
    "w",
    "na",
    "nie",
    "to",
    "się",
    "że",
    "jest",
    "z",
    "do",
    "jak",
    "ale",
    "czy",
    "o",
    "co",
    "tak",
    "są",
    "dla",
    "przez",
    "już",
    "po",
    "działa",
  ],
  pt: [
    "o",
    "a",
    "os",
    "as",
    "que",
    "e",
    "é",
    "de",
    "do",
    "da",
    "em",
    "um",
    "uma",
    "para",
    "com",
    "não",
    "no",
    "na",
    "por",
    "mais",
    "mas",
    "está",
    "são",
    "você",
    "isso",
  ],
  tr: [
    "ve",
    "bir",
    "bu",
    "için",
    "ile",
    "değil",
    "çok",
    "ne",
    "ama",
    "gibi",
    "daha",
    "olarak",
    "var",
    "yok",
    "mi",
    "sonra",
    "ben",
    "biz",
    "çalışmıyor",
    "olan",
  ],
  az: [
    "və",
    "bir",
    "bu",
    "üçün",
    "ilə",
    "də",
    "deyil",
    "çox",
    "nə",
    "amma",
    "kimi",
    "daha",
    "var",
    "yox",
    "mən",
    "biz",
    "olan",
    "işləmir",
  ],
  id: [
    "yang",
    "dan",
    "di",
    "ke",
    "dari",
    "ini",
    "itu",
    "untuk",
    "dengan",
    "tidak",
    "ada",
    "akan",
    "saya",
    "kami",
    "juga",
    "bisa",
    "sudah",
    "belum",
    "karena",
  ],
  vi: [
    "là",
    "và",
    "của",
    "có",
    "không",
    "được",
    "trong",
    "cho",
    "một",
    "những",
    "này",
    "với",
    "các",
    "đã",
    "để",
    "khi",
    "người",
    "thì",
    "cũng",
  ],
};

const STOPWORD_SETS = Object.fromEntries(
  Object.entries(STOPWORDS).map(([language, words]) => [
    language,
    new Set(words),
  ]),
) as Record<string, Set<string>>;

/** Letters that point at one Latin-script language, with their weight. */
const LETTER_HINTS: [RegExp, string, number][] = [
  [/ə/g, "az", 3],
  [/[ğşı]/g, "tr", 1],
  [/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹơưđ]/g, "vi", 3],
  [/[ąęłńśźż]/g, "pl", 2],
  [/ß/g, "de", 2],
  [/[ãõ]/g, "pt", 2],
  [/[ñ¿¡]/g, "es", 2],
  [/[œêëîïû]/g, "fr", 1],
];

type Script =
  | "latin"
  | "cyrillic"
  | "greek"
  | "devanagari"
  | "hangul"
  | "kana"
  | "han"
  | "arabic"
  | "hebrew"
  | "thai"
  | "other";

const SCRIPT_TESTS: [Script, RegExp][] = [
  ["latin", /\p{Script=Latin}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["greek", /\p{Script=Greek}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["han", /\p{Script=Han}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["thai", /\p{Script=Thai}/u],
];

/** The script each UI language is written in. */
const LANGUAGE_SCRIPT: Record<string, Script> = {
  ru: "cyrillic",
  uk: "cyrillic",
  mk: "cyrillic",
  el: "greek",
  hi: "devanagari",
  ko: "hangul",
  ja: "kana",
  zh: "han",
};

/** Code, links, mentions and Markdown marks say nothing about language. */
export function proseOf(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/[@#][\p{L}\p{N}_.-]+/gu, " ")
    .replace(/\b[A-Z][A-Z0-9]*-\d+\b/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function scriptCounts(text: string) {
  const counts = new Map<Script, number>();
  let letters = 0;
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    letters += 1;
    const script =
      SCRIPT_TESTS.find(([, pattern]) => pattern.test(char))?.[0] ?? "other";
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  return { counts, letters };
}

function dominantScript(counts: Map<Script, number>, letters: number) {
  let best: Script = "other";
  let bestCount = 0;
  for (const [script, count] of counts) {
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }
  return bestCount / letters >= 0.6 ? best : null;
}

function latinLanguage(text: string): string | null {
  const lower = text.toLowerCase();
  const scores = new Map<string, number>();
  const words = lower.match(/\p{L}+/gu) ?? [];
  for (const word of words) {
    for (const [language, set] of Object.entries(STOPWORD_SETS)) {
      if (set.has(word)) scores.set(language, (scores.get(language) ?? 0) + 1);
    }
  }
  for (const [pattern, language, weight] of LETTER_HINTS) {
    const hits = lower.match(pattern)?.length ?? 0;
    if (hits > 0) {
      scores.set(
        language,
        (scores.get(language) ?? 0) + weight * Math.min(hits, 3),
      );
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || first[1] < 2) return null;
  if (second && first[1] < second[1] * 1.5) return null;
  return first[0];
}

/**
 * The text's language as an ISO 639-1 code, or null when unsure (too
 * short, mixed, or a language this guess doesn't know).
 */
export function detectLanguage(text: string): string | null {
  const prose = proseOf(text);
  const { counts, letters } = scriptCounts(prose);
  if (letters < MIN_LETTERS) return null;
  const script = dominantScript(counts, letters);
  switch (script) {
    case "latin":
      return latinLanguage(prose);
    case "cyrillic":
      if (/[їєґі]/iu.test(prose)) return "uk";
      if (/[ѓќѕљњџј]/iu.test(prose)) return "mk";
      return "ru";
    case "greek":
      return "el";
    case "devanagari":
      return "hi";
    case "hangul":
      return "ko";
    case "kana":
      return "ja";
    case "han":
      // Kana anywhere means Japanese written mostly in kanji.
      return (counts.get("kana") ?? 0) > 0 ? "ja" : "zh";
    case "arabic":
      return "ar";
    case "hebrew":
      return "he";
    case "thai":
      return "th";
    default:
      return null;
  }
}

/** "pt-BR" → "pt". */
export function baseLanguage(locale: string): string {
  return (locale.split(/[-_]/)[0] ?? "").toLowerCase();
}

/**
 * Whether to offer "Translate" for a text to a reader with this UI locale:
 * a known other language, or clearly another script.
 */
export function shouldOfferTranslation(
  text: string,
  readerLocale: string,
): boolean {
  const reader = baseLanguage(readerLocale);
  const detected = detectLanguage(text);
  if (detected) return detected !== reader;
  const prose = proseOf(text);
  const { counts, letters } = scriptCounts(prose);
  if (letters < UNKNOWN_OFFER_LETTERS) return false;
  const script = dominantScript(counts, letters);
  const readerScript = LANGUAGE_SCRIPT[reader] ?? "latin";
  // Japanese readers also read kanji; kana-or-han both count as theirs.
  if (reader === "ja" && (script === "han" || script === "kana")) return false;
  return script !== null && script !== readerScript;
}
