// Characters file systems refuse in a name.
const RESERVED = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);

function isUnsafe(char: string): boolean {
  const code = char.charCodeAt(0);
  return RESERVED.has(char) || code < 0x20 || code === 0x7f;
}

/** A safe download name for a board ("Sprint 12 plan" → "Sprint 12 plan.png"). */
export function boardFileName(
  title: string,
  extension: "png" | "svg" | "margaya-board",
  fallback: string,
): string {
  const cleaned = Array.from(title, (char) => (isUnsafe(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 100)
    .trim();
  return `${cleaned || fallback}.${extension}`;
}
