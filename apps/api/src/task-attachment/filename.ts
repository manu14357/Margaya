export const MAX_ATTACHMENT_FILENAME_LENGTH = 255;

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

function isControl(code: number) {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * The name an attachment is stored and downloaded under: control characters
 * and path separators removed, trimmed, "file" when nothing is left, and at
 * most 255 characters, cut from the base name so the extension survives.
 */
export function sanitizeAttachmentFilename(raw: string): string {
  let cleaned = "";
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (isControl(code) || char === "/" || char === "\\") continue;
    cleaned += char;
  }
  cleaned = cleaned.trim();
  if (!cleaned) return "file";

  const characters = [...cleaned];
  if (characters.length <= MAX_ATTACHMENT_FILENAME_LENGTH) return cleaned;

  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 ? [...cleaned.slice(dot)] : [];
  if (
    extension.length === 0 ||
    extension.length >= MAX_ATTACHMENT_FILENAME_LENGTH
  ) {
    return characters.slice(0, MAX_ATTACHMENT_FILENAME_LENGTH).join("");
  }
  const base = [...cleaned.slice(0, dot)].slice(
    0,
    MAX_ATTACHMENT_FILENAME_LENGTH - extension.length,
  );
  return `${base.join("").trimEnd()}${extension.join("")}`;
}

/** Any type is accepted; an empty one is stored as a plain byte stream. */
export function normalizeAttachmentContentType(raw: string): string {
  return raw.trim() || FALLBACK_CONTENT_TYPE;
}
