/**
 * About `width` characters of `text` around the first case-insensitive match
 * of `query`, with an ellipsis on each side that was cut. Works in code
 * points, so a multi-byte character is never split. Without a match, the
 * start of the text.
 */
export function buildSearchSnippet(
  text: string,
  query: string,
  width = 160,
): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= width) return chars.join("");

  const lowerChars = chars.map((char) => char.toLowerCase());
  const needle = Array.from(query.toLowerCase());
  let matchAt = -1;
  if (needle.length > 0) {
    for (let i = 0; i + needle.length <= lowerChars.length; i++) {
      let found = true;
      for (let j = 0; j < needle.length; j++) {
        if (lowerChars[i + j] !== needle[j]) {
          found = false;
          break;
        }
      }
      if (found) {
        matchAt = i;
        break;
      }
    }
  }

  let start = 0;
  if (matchAt > 0) {
    const centered = matchAt - Math.floor((width - needle.length) / 2);
    start = Math.max(0, Math.min(centered, chars.length - width));
  }
  const end = Math.min(chars.length, start + width);

  const body = chars.slice(start, end).join("").trim();
  return `${start > 0 ? "…" : ""}${body}${end < chars.length ? "…" : ""}`;
}
