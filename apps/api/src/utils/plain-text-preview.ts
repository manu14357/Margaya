// A short plain-text preview of comment or description markdown for
// notifications: mention tags become "@Label", other tags and markdown
// markers go, whitespace collapses, and long text is cut on a word boundary.

export const PREVIEW_MAX_LENGTH = 160;

const MENTION_TAG =
  /<margaya-mention\b([^>]*)>(?:[\s\S]*?<\/margaya-mention>)?/gi;

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(attributes);
  return match?.[1] ?? null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

export function plainTextPreview(
  content: string | null | undefined,
  maxLength = PREVIEW_MAX_LENGTH,
): string {
  if (!content) return "";
  let text = content.replace(MENTION_TAG, (_tag, attributes: string) => {
    const label = attribute(attributes, "label") ?? "";
    return label ? `@${label}` : "";
  });
  // Line-start patterns match spaces and tabs only, and bracketed spans stop
  // at the next opener: a `\s*` that crosses lines, or a span that scans to
  // the end for every opener, turns long notes into quadratic work.
  text = text
    // Code fences keep their code, lose the fence lines.
    .replace(/^[ \t]*(```|~~~).*$/gm, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^<>]*>/gi, " ")
    // Images keep their alt text, links their label.
    .replace(/!\[([^[\]]*)\]\([^()]*\)/g, "$1")
    .replace(/\[([^[\]]*)\]\([^()]*\)/g, "$1")
    // Headings, quotes and list markers at line starts.
    .replace(/^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/gm, "")
    .replace(/^[ \t]*>+[ \t]?/gm, "")
    .replace(
      /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+|$)(?:\[[ xX]\](?:[ \t]+|$))?/gm,
      "",
    )
    // Horizontal rules.
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, " ")
    // Emphasis, strike-through and inline code markers.
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`+([^`]*)`+/g, "$1");
  text = decodeEntities(text).replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const boundary = cut.lastIndexOf(" ");
  const head = boundary > maxLength / 2 ? cut.slice(0, boundary) : cut;
  return `${head.replace(/[\s.,;:!?-]+$/, "")}…`;
}
