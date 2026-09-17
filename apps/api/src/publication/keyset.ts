import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// Keyset cursors on (timestamp, id) with microsecond precision: JavaScript
// dates keep only milliseconds, so the key is read back as text.

export const INVALID_CURSOR = "Invalid cursor";

export type Keyset = { at: string; id: string };

export function timeKey(column: AnyColumn): SQL<string> {
  return sql<string>`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
}

export function encodeKeyset(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id]), "utf8").toString("base64url");
}

export function decodeKeyset(raw: string): Keyset {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/.test(parsed[0]) &&
      typeof parsed[1] === "string" &&
      parsed[1].length > 0 &&
      parsed[1].length <= 64
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {}
  throw new HTTPException(400, { message: INVALID_CURSOR });
}

/** Rows after the cursor in (time, id) order, ascending or descending. */
export function afterKeyset(
  timeColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: Keyset,
  direction: "asc" | "desc",
): SQL {
  return direction === "asc"
    ? sql`(${timeColumn}, ${idColumn}) > (${cursor.at}::timestamp, ${cursor.id})`
    : sql`(${timeColumn}, ${idColumn}) < (${cursor.at}::timestamp, ${cursor.id})`;
}
