import { describe, expect, it } from "vitest";
import {
  decodeStickyCursor,
  encodeStickyCursor,
} from "../../../apps/api/src/sticky/cursor";

function raw(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("sticky cursor", () => {
  it("round-trips position and id, including negative positions", () => {
    for (const cursor of [
      { position: 0, id: "abc" },
      { position: -42, id: "k9x2" },
      { position: 499, id: "z" },
    ]) {
      const encoded = encodeStickyCursor(cursor);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeStickyCursor(encoded)).toEqual(cursor);
    }
  });

  it("rejects malformed cursors", () => {
    expect(decodeStickyCursor("not base64!")).toBeNull();
    expect(decodeStickyCursor(raw("{"))).toBeNull();
    expect(decodeStickyCursor(raw("[1]"))).toBeNull();
    expect(decodeStickyCursor(raw('[1,"a","b"]'))).toBeNull();
    expect(decodeStickyCursor(raw('["1","a"]'))).toBeNull();
    expect(decodeStickyCursor(raw('[1.5,"a"]'))).toBeNull();
    expect(decodeStickyCursor(raw('[1,""]'))).toBeNull();
    expect(decodeStickyCursor(raw("[1,2]"))).toBeNull();
    expect(decodeStickyCursor(raw('[99999999999,"a"]'))).toBeNull();
    expect(decodeStickyCursor(raw('{"position":1,"id":"a"}'))).toBeNull();
  });
});
