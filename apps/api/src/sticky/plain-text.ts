import { plainTextPreview } from "../utils/plain-text-preview";

export const STICKY_CONTENT_MAX_LENGTH = 20_000;

const TABLE_SEPARATOR_ROW = /^[|:\- \t]+$/;

// Table rows start with a pipe in the editor's markdown: separator rows go,
// other rows keep their cells.
function flattenTableRows(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) return line;
      if (trimmed.includes("-") && TABLE_SEPARATOR_ROW.test(trimmed)) {
        return " ";
      }
      return line.replaceAll("|", " ");
    })
    .join("\n");
}

/**
 * The searchable plain text of a sticky's markdown. It reuses the notification
 * preview rules (mentions become "@Label", tags go but keep their text, links
 * and images keep their text, markers and fences go, entities are decoded,
 * whitespace collapses) and adds table handling, cut without an ellipsis.
 */
export function stickyPlainText(content: string): string {
  // The preview decodes the numeric apostrophe entity only.
  const normalized = flattenTableRows(content).replace(/&apos;/gi, "&#39;");
  return plainTextPreview(normalized, Number.POSITIVE_INFINITY).slice(
    0,
    STICKY_CONTENT_MAX_LENGTH,
  );
}
