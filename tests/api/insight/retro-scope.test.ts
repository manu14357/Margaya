import { describe, expect, it } from "vitest";
import {
  cycleScopeChanges,
  visibleScope,
} from "../../../apps/api/src/insight/retro-scope";

const start = new Date("2026-03-02T00:00:00Z");
const end = new Date("2026-03-16T00:00:00Z");
const before = new Date("2026-02-28T00:00:00Z");
const during = new Date("2026-03-05T00:00:00Z");
const after = new Date("2026-03-17T00:00:00Z");

const change = (
  taskId: string,
  at: Date,
  move: { joined?: boolean; left?: boolean; toCycle?: string | null },
) => ({
  taskId,
  at,
  joined: move.joined ?? false,
  left: move.left ?? false,
  toCycle: move.toCycle ?? null,
});

describe("cycle scope changes", () => {
  it("classifies added, removed and carried-over tasks", () => {
    const sets = cycleScopeChanges({
      members: [
        { id: "committed", addedAt: before },
        { id: "late", addedAt: during },
      ],
      changes: [
        change("late", during, { joined: true }),
        change("dropped", before, { joined: true }),
        change("dropped", during, { left: true }),
        change("moved", after, { left: true, toCycle: "next" }),
        change("churn", during, { joined: true }),
        change("churn", during, { left: true }),
      ],
      start,
      end,
    });
    expect([...sets.added].sort()).toEqual(["churn", "late"]);
    expect([...sets.removed].sort()).toEqual(["churn", "dropped"]);
    expect([...sets.carried]).toEqual(["moved"]);
  });

  it("never removes or carries a task that is still in the cycle", () => {
    const sets = cycleScopeChanges({
      members: [{ id: "back", addedAt: during }],
      changes: [
        change("back", during, { left: true }),
        change("back", during, { joined: true }),
      ],
      start,
      end,
    });
    expect([...sets.added]).toEqual(["back"]);
    expect(sets.removed.size).toBe(0);
    expect(sets.carried.size).toBe(0);
  });

  it("keeps counts and lists in agreement by dropping invisible tasks", () => {
    // Five tasks joined during the cycle; two were deleted since. The retro
    // once counted five while listing three.
    const sets = cycleScopeChanges({
      members: [
        { id: "a", addedAt: during },
        { id: "b", addedAt: during },
      ],
      changes: [
        change("a", during, { joined: true }),
        change("b", during, { joined: true }),
        change("c", during, { joined: true }),
        change("c", after, { left: true }),
        change("gone-1", during, { joined: true }),
        change("gone-2", during, { joined: true }),
        change("gone-2", during, { left: true }),
      ],
      start,
      end,
    });
    expect(sets.added.size).toBe(5);
    const visible = new Set(["a", "b", "c"]);
    const shown = visibleScope(sets, (id) => visible.has(id));
    expect([...shown.added].sort()).toEqual(["a", "b", "c"]);
    expect(shown.removed.size).toBe(0);
    expect(shown.carried.size).toBe(0);
  });
});
