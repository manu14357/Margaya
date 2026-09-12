import { and, desc, eq, getTableColumns, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskExportTable } from "../../database/schema";
import { toTaskExportResponses } from "../serialize";

export const INVALID_CURSOR = "Invalid cursor";

type Cursor = { createdAt: string; id: string };

export function encodeExportCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify([cursor.createdAt, cursor.id]),
    "utf8",
  ).toString("base64url");
}

/** Throws 400 "Invalid cursor" when malformed. */
export function decodeExportCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new HTTPException(400, { message: INVALID_CURSOR });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string" ||
    parsed[1].length === 0 ||
    Number.isNaN(Date.parse(parsed[0]))
  ) {
    throw new HTTPException(400, { message: INVALID_CURSOR });
  }
  return { createdAt: parsed[0], id: parsed[1] };
}

// The creation instant with microseconds, so cursors are exact.
const createdAtKey = sql<string>`to_char(${taskExportTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** One page of a workspace's exports, newest first. */
export async function listTaskExports(input: {
  workspaceId: string;
  userId: string;
  scope: "mine" | "all";
  cursor?: string;
  limit: number;
}) {
  const after = input.cursor ? decodeExportCursor(input.cursor) : null;
  const conditions: (SQL | undefined)[] = [
    eq(taskExportTable.workspaceId, input.workspaceId),
    input.scope === "mine"
      ? eq(taskExportTable.requestedBy, input.userId)
      : undefined,
    after
      ? sql`(${taskExportTable.createdAt}, ${taskExportTable.id}) < (${after.createdAt}::timestamptz, ${after.id}::text)`
      : undefined,
  ];
  const rows = await db
    .select({ ...getTableColumns(taskExportTable), cursorKey: createdAtKey })
    .from(taskExportTable)
    .where(and(...conditions))
    .orderBy(desc(taskExportTable.createdAt), desc(taskExportTable.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > input.limit && last
      ? encodeExportCursor({ createdAt: last.cursorKey, id: last.id })
      : null;
  return {
    items: await toTaskExportResponses(
      page.map(({ cursorKey: _cursorKey, ...row }) => row),
    ),
    nextCursor,
  };
}
