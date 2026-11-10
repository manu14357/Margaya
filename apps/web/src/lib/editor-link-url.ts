import { normalizeLinkUrl } from "@/lib/link-url";

// Link addresses typed into a rich-text editor (comments, descriptions,
// pages): web addresses, with https assumed when the scheme is left out, and
// mailto: links. Anything else (javascript:, data:, ...) is refused here as
// well as by the editors' link extension.

export type EditorLinkError = "invalid" | "credentials" | "tooLong";

export type EditorLinkResult =
  | { ok: true; url: string }
  | { ok: false; error: EditorLinkError };

/** The i18n key of each validation message. */
export const EDITOR_LINK_ERROR_KEYS: Record<EditorLinkError, string> = {
  invalid: "common:linkDialog.invalid",
  credentials: "tasks:links.errors.credentials",
  tooLong: "tasks:links.errors.tooLong",
};

const MAILTO_PATTERN = /^mailto:[^\s@]+@[^\s@]+$/i;

/** Normalizes a non-empty link address, or says why it can't be used. */
export function normalizeEditorLinkUrl(raw: string): EditorLinkResult {
  const trimmed = raw.trim();
  if (/^mailto:/i.test(trimmed)) {
    return MAILTO_PATTERN.test(trimmed)
      ? { ok: true, url: trimmed }
      : { ok: false, error: "invalid" };
  }
  const result = normalizeLinkUrl(trimmed);
  if (result.ok) return { ok: true, url: result.url };
  if (result.error === "credentials" || result.error === "tooLong") {
    return { ok: false, error: result.error };
  }
  return { ok: false, error: "invalid" };
}
