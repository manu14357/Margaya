import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  decodeCommentCursor,
  encodeCommentCursor,
} from "../../../apps/api/src/comment/cursor";

describe("comment cursor", () => {
  it("round-trips the microsecond timestamp and id", () => {
    const cursor = { createdAt: "2026-01-01T10:00:00.123456", id: "abc123" };
    expect(decodeCommentCursor(encodeCommentCursor(cursor))).toEqual(cursor);
  });

  it.each([
    "not-a-cursor",
    Buffer.from("[]").toString("base64url"),
    Buffer.from(JSON.stringify(["2026-01-01", "id"])).toString("base64url"),
    Buffer.from(JSON.stringify(["2026-01-01T10:00:00.123456", ""])).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify(["2026-01-01T10:00:00.123456", "x".repeat(129)]),
    ).toString("base64url"),
  ])("rejects %s with a 400", (raw) => {
    try {
      decodeCommentCursor(raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(400);
    }
  });
});
