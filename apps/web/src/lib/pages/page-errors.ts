import { HttpError } from "@/lib/http-error";

/**
 * The API's message for an expected failure (a 4xx answered with plain
 * text, such as "This page is locked. Unlock it to make changes."), or null
 * when the toast should use its own copy.
 */
export function pageErrorMessage(error: unknown): string | null {
  if (!(error instanceof HttpError) || error.status >= 500) return null;
  const text = error.message.trim();
  if (!text || text.length > 200 || /^[{[<]/.test(text)) return null;
  return text;
}
