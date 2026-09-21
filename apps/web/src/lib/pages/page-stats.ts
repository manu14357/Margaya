// Live statistics of a page body (the Info tab).

export const WORDS_PER_MINUTE = 200;

export type PageStats = {
  words: number;
  characters: number;
  paragraphs: number;
  /** Whole minutes, rounded up; 0 for an empty page. */
  readingMinutes: number;
  /** Shown as "<1 min". */
  underAMinute: boolean;
};

/** Stats from the text of each text block (paragraph, heading, cell...). */
export function computePageStats(blocks: readonly string[]): PageStats {
  let words = 0;
  let characters = 0;
  let paragraphs = 0;
  for (const block of blocks) {
    characters += block.length;
    words += block.split(/\s+/).filter(Boolean).length;
    if (block.trim()) paragraphs += 1;
  }
  const minutes = words / WORDS_PER_MINUTE;
  return {
    words,
    characters,
    paragraphs,
    readingMinutes: Math.ceil(minutes),
    underAMinute: minutes < 1,
  };
}
