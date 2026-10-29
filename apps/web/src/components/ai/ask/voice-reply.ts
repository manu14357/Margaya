// Voice mode's pure parts: when a recording should end, what of an answer is
// read aloud, how it is split for the browser's voice, and whether a reply
// means "confirm" or "cancel". Kept free of the DOM so they can be tested.

import { withoutInternalRefs } from "./ask-citations";

/** Tuned for a person speaking a request, not dictating a long text. */
export const SILENCE = {
  /** The room's own level is measured this long before speech counts. */
  calibrateMs: 300,
  /** Silence after speech that ends the recording. */
  hangoverMs: 1_200,
  /** Speech shorter than this is noise (a click, a cough). */
  minSpeechMs: 400,
  /** Nothing said for this long: stop without sending. */
  noSpeechMs: 8_000,
  /** A recording never runs longer than this. */
  maxMs: 60_000,
  /** The quietest level that counts as speech, whatever the room. */
  floor: 0.02,
} as const;

export type SilenceEvent = "end" | "no-speech" | "max" | null;

/**
 * Feeds on the microphone's loudness (RMS, 0 to 1) over time and says when
 * to stop: after speech followed by a pause, after a long silence with no
 * speech at all, or at the length limit. The speech threshold follows the
 * room: three times its measured background level, never below `floor`.
 */
export function createSilenceDetector(
  options: Partial<Record<keyof typeof SILENCE, number>> = {},
) {
  const o = { ...SILENCE, ...options };
  let startedAt: number | null = null;
  let noise = 0;
  let samples = 0;
  let speechMs = 0;
  let lastAt: number | null = null;
  let lastSpeechAt: number | null = null;
  return {
    /** Whether speech has been heard so far. */
    get heard() {
      return speechMs >= o.minSpeechMs;
    },
    update(level: number, now: number): SilenceEvent {
      startedAt ??= now;
      const step = lastAt === null ? 0 : now - lastAt;
      lastAt = now;
      const elapsed = now - startedAt;
      if (elapsed < o.calibrateMs) {
        samples += 1;
        noise += (level - noise) / samples;
        return null;
      }
      const threshold = Math.max(o.floor, noise * 3);
      if (level >= threshold) {
        speechMs += step;
        lastSpeechAt = now;
      }
      if (elapsed >= o.maxMs) return "max";
      if (
        speechMs >= o.minSpeechMs &&
        lastSpeechAt !== null &&
        now - lastSpeechAt >= o.hangoverMs
      ) {
        return "end";
      }
      if (speechMs < o.minSpeechMs && elapsed >= o.noSpeechMs) {
        return "no-speech";
      }
      return null;
    },
  };
}

const MAX_SPOKEN_CHARS = 600;
const CITATION = /\s?\[(?:[TPCWD]):[^\]\n]{1,100}\]/g;

/**
 * An answer as plain sentences to read aloud: no citations, Markdown, code,
 * tables or follow-up lists. A chart becomes `chartNote`; a long answer
 * stops at a sentence and ends with `moreNote`.
 */
export function speakableText(
  answer: string,
  notes: { chartNote: string; moreNote: string },
): string {
  let hadChart = false;
  let text = withoutInternalRefs(answer)
    .replace(/```(\w*)[\s\S]*?(```|$)/g, (_block, language: string) => {
      if (language === "chart") hadChart = true;
      return "\n";
    })
    .replace(CITATION, "")
    .split("\n")
    // Tables read badly; the numbers stay on screen.
    .filter((line) => !/^\s*\|/.test(line))
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .trim(),
    )
    .filter(Boolean)
    // A list item without its own full stop still reads as a sentence.
    .map((line) => (/[.!?…:;。！？]$/.test(line) ? line : `${line}.`))
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    // Removed citations leave lists like "WEB-1, , and" and "defect,."
    .replace(/\(\s*\)/g, "")
    .replace(/\s*,(?:\s*,)+/g, ",")
    .replace(/,\s*([.!?;:])/g, "$1")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MAX_SPOKEN_CHARS) {
    const cut = text.slice(0, MAX_SPOKEN_CHARS);
    const end = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("? "),
      cut.lastIndexOf("。"),
    );
    text = `${end > 100 ? cut.slice(0, end + 1) : cut.trimEnd()} ${notes.moreNote}`;
  }
  if (hadChart) text = `${text} ${notes.chartNote}`.trim();
  return text;
}

/**
 * Text in pieces the browser's voice reads reliably: whole sentences, each
 * at most `max` characters (Chromium stops long utterances after about 15
 * seconds without telling anyone).
 */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    const trimmed = piece.trim();
    if (trimmed) chunks.push(trimmed);
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push(current);
      current = "";
      // A very long sentence breaks at commas, then at spaces.
      let rest = sentence;
      while (rest.length > max) {
        const window = rest.slice(0, max);
        const at = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
        const cut = at > max / 3 ? at + 1 : max;
        push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
      continue;
    }
    if ((current + sentence).length > max) {
      push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  push(current);
  return chunks;
}

/** Lower case, without punctuation, single spaces. */
function normalize(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a short spoken reply confirms or cancels. `confirm` and `cancel`
 * are comma-separated phrases in the person's language. A long reply is a
 * new request, not an answer, and mentions of both stay undecided.
 */
export function confirmIntent(
  reply: string,
  words: { confirm: string; cancel: string },
): "confirm" | "cancel" | null {
  const said = normalize(reply);
  if (!said || said.split(" ").length > 6) return null;
  const has = (list: string) =>
    list
      .split(",")
      .map(normalize)
      .filter(Boolean)
      .some((phrase) => ` ${said} `.includes(` ${phrase} `));
  const yes = has(words.confirm);
  const no = has(words.cancel);
  if (yes === no) return null;
  return yes ? "confirm" : "cancel";
}
