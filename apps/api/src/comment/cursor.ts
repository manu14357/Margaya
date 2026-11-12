import { HTTPException } from "hono/http-exception";

// Same format as the activity feeds' cursors: the row's created_at in the
// database's own microsecond text form (a JS Date keeps only milliseconds)
// plus its id, as base64url JSON.
export type CommentCursor = { createdAt: string; id: string };

const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;

export function encodeCommentCursor(cursor: CommentCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.createdAt, cursor.id]),
    "utf8",
  ).toString("base64url");
}

export function decodeCommentCursor(raw: string): CommentCursor {
  const invalid = () => new HTTPException(400, { message: "Invalid cursor" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    !CURSOR_TIME.test(parsed[0]) ||
    typeof parsed[1] !== "string" ||
    parsed[1].length === 0 ||
    parsed[1].length > 128
  ) {
    throw invalid();
  }
  return { createdAt: parsed[0], id: parsed[1] };
}
