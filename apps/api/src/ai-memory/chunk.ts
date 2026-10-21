import { createHash } from "node:crypto";

// What gets embedded (D1). Tasks and comments are one chunk each; pages are
// split into chunks of about 800 tokens at paragraph or sentence breaks,
// with a little overlap so a thought cut in two is still found.

/** About 1,500 tokens: tasks and comments longer than this are cut. */
export const MAX_SINGLE_CHARS = 6000;
/** About 800 tokens per page chunk. */
export const CHUNK_CHARS = 3200;
export const CHUNK_OVERLAP = 300;
export const MAX_PAGE_CHUNKS = 24;

/** Plain, compact text: no HTML tags, collapsed blank space. */
export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/<[^>]{1,500}>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*(\n\s*)+/g, "\n\n")
    .trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

export function taskEmbeddingText(
  title: string,
  description: string | null,
): string {
  const body = plainText(description);
  return clip(
    body ? `${title.trim()}\n\n${body}` : title.trim(),
    MAX_SINGLE_CHARS,
  );
}

export function commentEmbeddingText(
  taskTitle: string | null,
  content: string | null,
): string {
  const body = plainText(content);
  const prefix = taskTitle?.trim() ? `${taskTitle.trim()}\n\n` : "";
  return clip(`${prefix}${body}`, MAX_SINGLE_CHARS);
}

/** Where to cut near `end`: a paragraph, line or sentence break, else `end`. */
function breakPoint(text: string, start: number, end: number): number {
  if (end >= text.length) return text.length;
  const window = text.slice(start, end);
  const floor = Math.floor((end - start) * 0.5);
  for (const separator of ["\n\n", "\n", ". ", "? ", "! ", " "]) {
    const at = window.lastIndexOf(separator);
    if (at >= floor) return start + at + separator.length;
  }
  return end;
}

/** Splits text into overlapping chunks of at most `size` characters. */
export function chunkText(
  text: string,
  options: { size?: number; overlap?: number; max?: number } = {},
): string[] {
  const size = options.size ?? CHUNK_CHARS;
  const overlap = Math.min(options.overlap ?? CHUNK_OVERLAP, size / 2);
  const max = options.max ?? MAX_PAGE_CHUNKS;
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length && chunks.length < max) {
    const end = breakPoint(trimmed, start, start + size);
    const chunk = trimmed.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= trimmed.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Page chunks; each carries the title so a chunk reads on its own. */
export function pageEmbeddingChunks(
  title: string | null,
  contentText: string | null,
): string[] {
  const heading = title?.trim() ?? "";
  const body = plainText(contentText);
  const room = CHUNK_CHARS - Math.min(heading.length, 200) - 2;
  const chunks = chunkText(body, { size: Math.max(room, 1000) });
  if (chunks.length === 0) return heading ? [heading] : [];
  return chunks.map((chunk) =>
    heading ? `${heading.slice(0, 200)}\n\n${chunk}` : chunk,
  );
}

/** The change marker of an entity's embedded text under a model. */
export function contentHash(model: string, chunks: readonly string[]): string {
  const hash = createHash("sha256").update(model);
  for (const chunk of chunks) hash.update("\u0000").update(chunk);
  return hash.digest("hex").slice(0, 40);
}
