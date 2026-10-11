import { describe, expect, it } from "vitest";
import {
  versionAction,
  versionsBeyondLimit,
} from "../../../apps/api/src/page/rules";

const now = new Date("2026-05-01T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000);

describe("page version coalescing", () => {
  it("updates the same user's version within 10 minutes", () => {
    for (const minutes of [0, 5, 10]) {
      expect(
        versionAction({
          newest: { ownerId: "u1", lastSavedAt: minutesAgo(minutes) },
          userId: "u1",
          now,
        }),
      ).toBe("update");
    }
  });

  it("inserts after 10 minutes, for another user, or with no version yet", () => {
    expect(
      versionAction({
        newest: { ownerId: "u1", lastSavedAt: minutesAgo(10.01) },
        userId: "u1",
        now,
      }),
    ).toBe("insert");
    expect(
      versionAction({
        newest: { ownerId: "u2", lastSavedAt: minutesAgo(1) },
        userId: "u1",
        now,
      }),
    ).toBe("insert");
    expect(versionAction({ newest: null, userId: "u1", now })).toBe("insert");
    expect(
      versionAction({
        newest: { ownerId: null, lastSavedAt: minutesAgo(1) },
        userId: null,
        now,
      }),
    ).toBe("insert");
  });

  it("always inserts for a restore", () => {
    expect(
      versionAction({
        newest: { ownerId: "u1", lastSavedAt: minutesAgo(1) },
        userId: "u1",
        now,
        forceNew: true,
      }),
    ).toBe("insert");
  });

  it("keeps the newest 20", () => {
    const ids = Array.from({ length: 23 }, (_, index) => `v${index}`);
    expect(versionsBeyondLimit(ids)).toEqual(["v20", "v21", "v22"]);
    expect(versionsBeyondLimit(ids.slice(0, 20))).toEqual([]);
  });
});
