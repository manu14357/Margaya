// Keyset cursor for the sticky list: the last returned row's position and id,
// as opaque base64url JSON.

export type StickyCursor = { position: number; id: string };

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

export function encodeStickyCursor(cursor: StickyCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.position, cursor.id]),
    "utf8",
  ).toString("base64url");
}

/** The position and id a cursor carries, or null when it is malformed. */
export function decodeStickyCursor(raw: string): StickyCursor | null {
  if (!CURSOR_PATTERN.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [position, id] = parsed;
  if (
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    Math.abs(position) > 2_147_483_647 ||
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 128
  ) {
    return null;
  }
  return { position, id };
}
