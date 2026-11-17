/**
 * Splits text for a middle ellipsis: the head shrinks and ends in "…", the
 * tail always shows. An email keeps its "@domain" when the domain is short
 * enough to be useful; anything else keeps its last `tailLength` characters
 * (the distinctive end of an id, a key prefix or a URL path).
 */
export function splitForMiddleTruncation(
  text: string,
  { tailLength = 8, maxEmailTail = 32 } = {},
): { head: string; tail: string } {
  const at = text.lastIndexOf("@");
  if (at > 0 && at < text.length - 1) {
    const domain = text.slice(at + 1);
    if (domain.length + 1 <= maxEmailTail) {
      return { head: text.slice(0, at), tail: text.slice(at) };
    }
    // A very long domain: keep its last two labels whole ("example.net"),
    // never a cut through a word. head + tail stays the exact text, so it
    // reads in full when it fits and for screen readers.
    const labels = domain.split(".");
    if (labels.length >= 2) {
      const end = labels.slice(-2).join(".");
      return { head: text.slice(0, text.length - end.length), tail: end };
    }
  }
  // Too short to be worth splitting: the whole text truncates at the end.
  if (text.length <= tailLength * 2) return { head: text, tail: "" };
  return {
    head: text.slice(0, text.length - tailLength),
    tail: text.slice(text.length - tailLength),
  };
}

/** A compact date for dense lists: relative within a week, a short date after. */
export function compactDateKind(
  value: Date,
  now: Date,
): "relative" | "short" | "medium" {
  const ageMs = Math.abs(now.getTime() - value.getTime());
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return "relative";
  return value.getFullYear() === now.getFullYear() ? "short" : "medium";
}
