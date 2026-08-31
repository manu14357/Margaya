// The same escaping the web editor's task link, attachment and embed nodes
// use for their markdown attributes. Keep both copies byte-identical.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

/** Reverses the standard HTML entities (named, decimal and hex) in one pass. */
export function unescapeHtml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const isHex = entity[1] === "x" || entity[1] === "X";
        const code = Number.parseInt(
          entity.slice(isHex ? 2 : 1),
          isHex ? 16 : 10,
        );
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

/**
 * Reads `name="value"` pairs from the attribute part of a custom tag. Values
 * are unescaped; unquoted or malformed attributes are ignored.
 */
export function readTagAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)) {
    const [, name, value] = match;
    if (name && value !== undefined) {
      attributes[name.toLowerCase()] = unescapeHtml(value);
    }
  }
  return attributes;
}
