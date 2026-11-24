import { HTTPException } from "hono/http-exception";

// Server-side sanitizer for public board content (B12 K15, §3.11). Pure.
// The stored text stays markdown: no raw HTML, no images, no mentions.

export const MAX_PUBLIC_LINKS = 10;
export const MAX_PUBLIC_COMMENT_LENGTH = 5000;
export const MAX_PUBLIC_REQUEST_DESCRIPTION_LENGTH = 10_000;
export const MAX_PUBLIC_REQUEST_TITLE_LENGTH = 255;

export const SANITIZE_MESSAGES = {
  emptyComment: "Write something first",
  longComment: "Comments can be at most 5,000 characters",
  commentLinks: "Too many links in one comment",
  requestLinks: "Too many links in one request",
  emptyTitle: "Give your request a title",
  longTitle: "Titles can be at most 255 characters",
  longDescription: "Descriptions can be at most 10,000 characters",
} as const;

const MENTION_TAG =
  /<margaya-mention\b([^>]*?)(?:\/>|>([\s\S]*?)<\/margaya-mention>)/gi;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HTML_TAG = /<\/?[a-zA-Z][\w:-]*(?:\s[^<>]*)?\/?>/g;
// ![alt](url "title") and ![alt][ref]
const INLINE_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const REFERENCE_IMAGE = /!\[([^\]]*)\]\[([^\]]*)\]/g;
const LINK = /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi;

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(attributes);
  return match?.[1] ?? null;
}

/** Steps 1-4: normalized, mention tags flattened, HTML gone, images as links. */
export function stripPublicMarkup(raw: string): string {
  let text = raw.replace(/\r\n?/g, "\n").trim();
  text = text.replace(
    MENTION_TAG,
    (_tag, attributes: string, inner?: string) => {
      const innerText = (inner ?? "").replace(HTML_TAG, "").trim();
      if (innerText) return innerText;
      const label =
        attribute(attributes, "label") ?? attribute(attributes, "data-label");
      return label ? `@${label}` : "";
    },
  );
  text = text.replace(HTML_COMMENT, "");
  text = text.replace(HTML_TAG, "");
  text = text.replace(
    INLINE_IMAGE,
    (_image, alt: string, url: string) => `[${alt || url}](${url})`,
  );
  text = text.replace(
    REFERENCE_IMAGE,
    (_image, alt: string, ref: string) => `[${alt || ref}][${ref || alt}]`,
  );
  return text.trim();
}

export function countLinks(text: string): number {
  return text.match(LINK)?.length ?? 0;
}

/** A public board comment, ready to store; 400 when unusable. */
export function sanitizePublicComment(raw: string): string {
  const text = stripPublicMarkup(raw);
  if (!text)
    throw new HTTPException(400, { message: SANITIZE_MESSAGES.emptyComment });
  if (countLinks(text) > MAX_PUBLIC_LINKS) {
    throw new HTTPException(400, { message: SANITIZE_MESSAGES.commentLinks });
  }
  if (text.length > MAX_PUBLIC_COMMENT_LENGTH) {
    throw new HTTPException(400, { message: SANITIZE_MESSAGES.longComment });
  }
  return text;
}

// Markdown that would show as syntax in a plain-text title. Only the syntax
// goes: punctuation people type ("Export (CSV)", "C# support", "Wow!") stays.
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g;
const MARKDOWN_REFERENCE_LINK = /\[([^\]]+)\]\[[^\]]*\]/g;
// Paired emphasis, strikethrough and code markers, not inside words
// (snake_case_names keep their underscores).
const MARKDOWN_EMPHASIS = /(?<!\w)(\*\*|__|~~|\*|_|`)(?=\S)(.*?\S)\1(?!\w)/g;
// Heading and quote markers at the start of a line.
const MARKDOWN_LINE_MARKER = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?)+/gm;

function markdownToPlainText(text: string): string {
  let plain = text
    .replace(MARKDOWN_LINE_MARKER, "")
    .replace(MARKDOWN_LINK, (_link, label: string) => label)
    .replace(MARKDOWN_REFERENCE_LINK, (_link, label: string) => label);
  // Twice for nesting such as ***bold italic***.
  for (let pass = 0; pass < 2; pass++) {
    plain = plain.replace(MARKDOWN_EMPHASIS, (_match, _marker, inner) => inner);
  }
  return plain;
}

/** A request title: plain text, whitespace collapsed, 1-255 characters. */
export function sanitizeRequestTitle(raw: string): string {
  const title = markdownToPlainText(stripPublicMarkup(raw))
    .replace(/\s+/g, " ")
    .trim();
  if (!title)
    throw new HTTPException(400, { message: SANITIZE_MESSAGES.emptyTitle });
  if (title.length > MAX_PUBLIC_REQUEST_TITLE_LENGTH) {
    throw new HTTPException(400, { message: SANITIZE_MESSAGES.longTitle });
  }
  return title;
}

/** A request description: sanitized like a comment, up to 10,000 characters. */
export function sanitizeRequestDescription(raw: string | undefined): string {
  const text = stripPublicMarkup(raw ?? "");
  if (countLinks(text) > MAX_PUBLIC_LINKS) {
    throw new HTTPException(400, { message: SANITIZE_MESSAGES.requestLinks });
  }
  if (text.length > MAX_PUBLIC_REQUEST_DESCRIPTION_LENGTH) {
    throw new HTTPException(400, {
      message: SANITIZE_MESSAGES.longDescription,
    });
  }
  return text;
}
