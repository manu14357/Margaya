/**
 * Command-bar prefixes (design spec §7.5): plain text searches everything;
 * a leading `>` narrows to actions, `#` to tasks, `@` to people and `/` to
 * places (destinations and projects).
 */
export const PALETTE_PREFIXES = {
  ">": "actions",
  "#": "tasks",
  "@": "people",
  "/": "places",
} as const;

export type PalettePrefix = keyof typeof PALETTE_PREFIXES;
export type PaletteMode = "all" | (typeof PALETTE_PREFIXES)[PalettePrefix];

export function isPalettePrefix(value: string): value is PalettePrefix {
  return Object.hasOwn(PALETTE_PREFIXES, value);
}

export function parsePaletteQuery(query: string): {
  mode: PaletteMode;
  term: string;
} {
  const trimmed = query.trimStart();
  const first = trimmed.charAt(0);
  if (isPalettePrefix(first)) {
    return { mode: PALETTE_PREFIXES[first], term: trimmed.slice(1).trim() };
  }
  return { mode: "all", term: trimmed.trim() };
}

/** Every word of the term appears in one of the texts, ignoring case. */
export function matchesTerm(
  term: string,
  ...texts: Array<string | null | undefined>
): boolean {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts
    .filter((text): text is string => Boolean(text))
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}
