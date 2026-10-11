import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  queryHash,
  stableStringify,
} from "../../../apps/api/src/task-query/cursor";

describe("stableStringify", () => {
  it("ignores key order and undefined members", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe(
      stableStringify({ a: [2, { d: 3 }], b: 1 }),
    );
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe("cursors", () => {
  const query = { workspaceId: "w1", groupBy: "priority", filters: null };
  const hash = queryHash(query, "high", null);

  it("round-trips an offset", () => {
    expect(decodeCursor(encodeCursor(150, hash), hash)).toBe(150);
    expect(decodeCursor(encodeCursor(0, hash), hash)).toBe(0);
  });

  it("binds the hash to the query, the group and the cell", () => {
    expect(queryHash({ ...query }, "high", null)).toBe(hash);
    expect(queryHash({ ...query, groupBy: "status" }, "high", null)).not.toBe(
      hash,
    );
    expect(queryHash(query, "low", null)).not.toBe(hash);
    expect(queryHash(query, "high", "user-1")).not.toBe(hash);
  });

  it("refuses a cursor from another query", () => {
    const other = queryHash({ ...query, archived: "only" }, "high", null);
    expect(decodeCursor(encodeCursor(50, other), hash)).toBeNull();
  });

  it("refuses tampered or malformed input", () => {
    expect(
      decodeCursor(Buffer.from(`50.${hash}X`).toString("base64url"), hash),
    ).toBeNull();
    expect(decodeCursor("not a cursor!", hash)).toBeNull();
    expect(
      decodeCursor(Buffer.from(`-5.${hash}`).toString("base64url"), hash),
    ).toBeNull();
    expect(
      decodeCursor(Buffer.from(`abc.${hash}`).toString("base64url"), hash),
    ).toBeNull();
    expect(decodeCursor("", hash)).toBeNull();
  });
});
