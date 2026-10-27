import { describe, expect, it } from "vitest";
import type { ColumnGroup } from "../../../apps/api/src/column/groups";
import {
  cycleTimeDays,
  rebuildTaskFlow,
  wipAt,
} from "../../../apps/api/src/delivery/flow-intervals";

const GROUPS: Record<string, ColumnGroup> = {
  "to-do": "unstarted",
  "in-progress": "started",
  "in-review": "started",
  done: "completed",
};
const groupOf = (slug: string) => GROUPS[slug] ?? null;
const at = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
const move = (day: number, oldStatus: string, newStatus: string) => ({
  at: at(day),
  oldStatus,
  newStatus,
});

describe("rebuildTaskFlow", () => {
  it("rebuilds stints from status changes", () => {
    const flow = rebuildTaskFlow(
      {
        createdAt: at(1),
        status: "done",
        events: [
          move(2, "to-do", "in-progress"),
          move(4, "in-progress", "in-review"),
          move(5, "in-review", "to-do"),
          move(7, "to-do", "in-progress"),
          move(9, "in-progress", "done"),
        ],
      },
      groupOf,
    );
    expect(flow.intervals).toEqual([
      { start: at(2), end: at(5) },
      { start: at(7), end: at(9) },
    ]);
    expect(flow.firstStartedAt).toEqual(at(2));
    expect(flow.currentStartedAt).toBeNull();
    expect(cycleTimeDays(flow, at(9))).toBe(7);
  });

  it("starts at creation for a task created in progress", () => {
    const flow = rebuildTaskFlow(
      { createdAt: at(3), status: "in-progress", events: [] },
      groupOf,
    );
    expect(flow.currentStartedAt).toEqual(at(3));
    expect(flow.intervals).toEqual([{ start: at(3), end: null }]);
  });

  it("has no cycle time for work moved straight to done", () => {
    const flow = rebuildTaskFlow(
      { createdAt: at(1), status: "done", events: [move(3, "to-do", "done")] },
      groupOf,
    );
    expect(cycleTimeDays(flow, at(3))).toBeNull();
  });

  it("ignores unknown slugs and drops a stint history can't close", () => {
    const flow = rebuildTaskFlow(
      {
        createdAt: at(1),
        status: "to-do",
        events: [move(2, "gone", "in-progress")],
      },
      groupOf,
    );
    expect(flow.intervals).toEqual([]);
    expect(flow.currentStartedAt).toBeNull();
  });
});

describe("wipAt", () => {
  it("counts tasks in progress at each instant", () => {
    const flows = [
      rebuildTaskFlow(
        {
          createdAt: at(1),
          status: "done",
          events: [
            move(2, "to-do", "in-progress"),
            move(5, "in-progress", "done"),
          ],
        },
        groupOf,
      ),
      rebuildTaskFlow(
        { createdAt: at(4), status: "in-progress", events: [] },
        groupOf,
      ),
    ];
    expect(wipAt(flows, [at(1), at(3), at(4), at(6)])).toEqual([0, 1, 2, 1]);
  });
});
