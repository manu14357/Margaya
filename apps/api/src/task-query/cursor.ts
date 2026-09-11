import { createHash } from "node:crypto";

// Group paging cursors: an offset bound to a short hash of the normalized
// query (everything except `page`) and of the group or cell it pages, so a
// cursor from another query, group or cell is refused instead of silently
// paging the wrong list.

export const STALE_RESULTS = "These results changed; reload the list";

const MAX_OFFSET = 999_999_999;
const HASH_LENGTH = 16;

/** JSON with object keys sorted and undefined members dropped. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function queryHash(
  normalizedQuery: unknown,
  group: string,
  subGroup: string | null,
): string {
  return createHash("sha256")
    .update(stableStringify(normalizedQuery))
    .update("\u0000")
    .update(group)
    .update("\u0000")
    .update(subGroup ?? "")
    .digest("base64url")
    .slice(0, HASH_LENGTH);
}

export function encodeCursor(offset: number, hash: string): string {
  return Buffer.from(`${offset}.${hash}`, "utf8").toString("base64url");
}

/** The offset a cursor carries, or null when it is malformed or stale. */
export function decodeCursor(cursor: string, hash: string): number | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cursor)) return null;
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^(\d{1,9})\.([A-Za-z0-9_-]+)$/.exec(text);
  if (!match || match[2] !== hash) return null;
  const offset = Number(match[1]);
  return offset <= MAX_OFFSET ? offset : null;
}
