// Text layout with an injected measure function, so the browser can use the
// canvas metrics and Node can fall back to a width estimate.

import type { FontFamily } from "../elements.js";
import type { MeasureText } from "./types.js";

export const FONT_STACKS: Record<FontFamily, string> = {
  hand: '"Margaya Hand", "Segoe Print", "Comic Sans MS", cursive',
  sans: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

/** Default line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;

export const ELLIPSIS = "…";

function stackOf(family: string): string {
  return family in FONT_STACKS
    ? FONT_STACKS[family as FontFamily]
    : FONT_STACKS.sans;
}

/** CSS font shorthand, e.g. `600 14px "Geist Variable", ...`. */
export function fontCss(
  family: FontFamily | string,
  size: number,
  weight?: number,
): string {
  const px =
    Number.isFinite(size) && size > 0 ? Math.round(size * 100) / 100 : 16;
  return `${weight ? `${weight} ` : ""}${px}px ${stackOf(family)}`;
}

export type TextLayoutOptions = {
  fontSize: number;
  fontFamily: FontFamily | string;
  /** Wrap width; `Infinity` (or <= 0) keeps only the explicit line breaks. */
  maxWidth: number;
  /** Multiple of the font size; defaults to `LINE_HEIGHT`. */
  lineHeight?: number;
  /** Clamp to this many lines, ending the last with an ellipsis. */
  maxLines?: number;
  fontWeight?: number;
};

export type TextLayout = {
  lines: string[];
  width: number;
  height: number;
  /** Line height in board units. */
  lineHeightPx: number;
  font: string;
};

/** Breaks a word that alone is wider than the line, character by character. */
function splitLongWord(
  word: string,
  maxWidth: number,
  measureWith: (s: string) => number,
): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of Array.from(word)) {
    const candidate = current + char;
    if (current && measureWith(candidate) > maxWidth) {
      pieces.push(current);
      current = char;
    } else current = candidate;
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measureWith: (s: string) => number,
): string[] {
  if (paragraph === "") return [""];
  if (!(maxWidth > 0) || !Number.isFinite(maxWidth)) return [paragraph];
  if (measureWith(paragraph) <= maxWidth) return [paragraph];
  const tokens = paragraph.match(/\s+|\S+/g) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const isSpace = /^\s+$/.test(token);
    if (isSpace) {
      // Spaces never start a wrapped line; they only separate words.
      if (line) line += token;
      continue;
    }
    const candidate = line + token;
    if (measureWith(candidate.trimEnd()) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    line = "";
    if (measureWith(token) <= maxWidth) {
      line = token;
      continue;
    }
    const pieces = splitLongWord(token, maxWidth, measureWith);
    for (let index = 0; index < pieces.length - 1; index++) {
      lines.push(pieces[index] as string);
    }
    line = pieces[pieces.length - 1] ?? "";
  }
  if (line.trim() || lines.length === 0) lines.push(line.trimEnd());
  return lines;
}

/** Shortens `text` so it fits `maxWidth`, ending with an ellipsis. */
export function truncateText(
  text: string,
  maxWidth: number,
  font: string,
  measure: MeasureText,
): string {
  if (!(maxWidth > 0) || measure(text, font) <= maxWidth) return text;
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${chars.slice(0, middle).join("").trimEnd()}${ELLIPSIS}`;
    if (measure(candidate, font) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${chars.slice(0, low).join("").trimEnd()}${ELLIPSIS}`;
}

export function layoutText(
  text: string,
  options: TextLayoutOptions,
  measure: MeasureText,
): TextLayout {
  const fontSize =
    Number.isFinite(options.fontSize) && options.fontSize > 0
      ? options.fontSize
      : 16;
  const font = fontCss(options.fontFamily, fontSize, options.fontWeight);
  const lineHeightPx =
    fontSize *
    (options.lineHeight && options.lineHeight > 0
      ? options.lineHeight
      : LINE_HEIGHT);
  const maxWidth =
    Number.isFinite(options.maxWidth) && options.maxWidth > 0
      ? options.maxWidth
      : Number.POSITIVE_INFINITY;
  const widths = new Map<string, number>();
  const measureWith = (value: string) => {
    let width = widths.get(value);
    if (width === undefined) {
      width = measure(value, font);
      if (!Number.isFinite(width)) width = 0;
      widths.set(value, width);
    }
    return width;
  };
  let lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    lines.push(...wrapParagraph(paragraph, maxWidth, measureWith));
  }
  const maxLines = options.maxLines;
  if (maxLines && maxLines > 0 && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const lastIndex = maxLines - 1;
    const last = lines[lastIndex] as string;
    const limit = Number.isFinite(maxWidth) ? maxWidth : measureWith(last) + 1;
    lines[lastIndex] = truncateText(`${last}${ELLIPSIS}`, limit, font, measure);
    if (!lines[lastIndex]?.endsWith(ELLIPSIS)) lines[lastIndex] += ELLIPSIS;
  }
  let width = 0;
  for (const line of lines) width = Math.max(width, measureWith(line));
  return {
    lines,
    width,
    height: lines.length * lineHeightPx,
    lineHeightPx,
    font,
  };
}

/**
 * A server-side width estimate from per-character classes, used when no real
 * font metrics exist. It errs slightly wide so wrapped text rarely overflows.
 */
export function estimateTextWidth(text: string, font: string): number {
  const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = sizeMatch ? Number(sizeMatch[1]) : 16;
  const mono = /monospace|Mono/.test(font);
  const hand = /cursive/.test(font);
  let units = 0;
  for (const char of text) {
    if (mono) {
      units += isWide(char) ? 1.2 : 0.62;
      continue;
    }
    if (char === " ") units += 0.3;
    else if (isWide(char)) units += 1;
    else if (/[ilIjt.,:;'|!()[\]{}]/.test(char)) units += 0.3;
    else if (/[mwMW@%]/.test(char)) units += 0.88;
    else if (/[A-Z]/.test(char)) units += 0.68;
    else if (/[0-9]/.test(char)) units += 0.58;
    else units += 0.56;
  }
  return units * size * (hand ? 1.08 : 1);
}

function isWide(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f300
  );
}
