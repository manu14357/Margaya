import { describe, expect, it } from "vitest";
import {
  buildWorkload,
  type DoneRow,
  type OpenRow,
} from "../../../apps/api/src/analytics/workload-math";

const open = (
  userId: string | null,
  group: string,
  tasks: number,
  points = 0,
  sized = 0,
): OpenRow => ({ userId, group, tasks, points, sized });

const done = (userId: string, tasks: number, points = 0): DoneRow => ({
  userId,
  tasks,
  points,
});

describe("buildWorkload", () => {
  it("counts tasks without a points system, heaviest first, unassigned last", () => {
    const { unit, members } = buildWorkload({
      open: [
        open(null, "unstarted", 9),
        open("ann", "started", 1),
        open("ben", "started", 2),
        open("ben", "backlog", 3),
      ],
      done: [],
      pointsAvailable: false,
      includeCheck: false,
    });
    expect(unit).toBe("tasks");
    expect(members.map((member) => member.userId)).toEqual([
      "ben",
      "ann",
      null,
    ]);
    expect(members[0]).toMatchObject({
      tasks: 5,
      load: 5,
      cells: { backlog: 3, unstarted: 0, started: 2 },
      check: null,
    });
  });

  it("uses estimates when most open work is sized, else task counts", () => {
    const sized = buildWorkload({
      open: [open("ann", "started", 2, 13, 2), open("ben", "started", 1)],
      done: [],
      pointsAvailable: true,
      includeCheck: false,
    });
    expect(sized.unit).toBe("points");
    expect(sized.members[0]).toMatchObject({
      userId: "ann",
      tasks: 2,
      points: 13,
      load: 13,
      cells: { started: 13 },
    });

    const unsized = buildWorkload({
      open: [open("ann", "started", 1, 8, 1), open("ben", "started", 4)],
      done: [],
      pointsAvailable: true,
      includeCheck: false,
    });
    expect(unsized.unit).toBe("tasks");
    expect(unsized.members[0]).toMatchObject({ userId: "ben", load: 4 });

    // Points exist on tasks, but no scope project has a points system now.
    expect(
      buildWorkload({
        open: [open("ann", "started", 2, 13, 2)],
        done: [],
        pointsAvailable: false,
        includeCheck: false,
      }).unit,
    ).toBe("tasks");
  });

  it("flags who is above what they finished in a usual four weeks", () => {
    const { members } = buildWorkload({
      open: [open("ann", "started", 6), open("ben", "started", 3)],
      // Eight weeks of history, scaled to four.
      done: [done("ann", 8), done("ben", 8)],
      pointsAvailable: false,
      includeCheck: true,
    });
    expect(members[0]?.check).toEqual({
      unit: "tasks",
      load: 6,
      usual: 4,
      status: "over",
    });
    expect(members[1]?.check).toEqual({
      unit: "tasks",
      load: 3,
      usual: 4,
      status: "ok",
    });
  });

  it("is not over exactly at the usual", () => {
    const { members } = buildWorkload({
      open: [open("ann", "started", 4)],
      done: [done("ann", 8)],
      pointsAvailable: false,
      includeCheck: true,
    });
    expect(members[0]?.check?.status).toBe("ok");
  });

  it("calls someone without history unknown, never over", () => {
    const { members } = buildWorkload({
      open: [open("new", "started", 40)],
      done: [],
      pointsAvailable: false,
      includeCheck: true,
    });
    expect(members[0]?.check).toEqual({
      unit: "tasks",
      load: 40,
      usual: null,
      status: "unknown",
    });
  });

  it("checks a person by task count when their own work is mostly unsized", () => {
    const { unit, members } = buildWorkload({
      open: [
        open("ann", "started", 10, 40, 10),
        // Nearly no points, but plenty of work: points alone would hide it.
        open("ben", "started", 6, 1, 1),
      ],
      done: [done("ann", 40, 200), done("ben", 8, 2)],
      pointsAvailable: true,
      includeCheck: true,
    });
    expect(unit).toBe("points");
    expect(members[0]?.check).toEqual({
      unit: "points",
      load: 40,
      usual: 100,
      status: "ok",
    });
    expect(members[1]?.check).toEqual({
      unit: "tasks",
      load: 6,
      usual: 4,
      status: "over",
    });
  });

  it("never checks unassigned work, and leaves the check out without the right", () => {
    const withRight = buildWorkload({
      open: [open(null, "started", 3)],
      done: [],
      pointsAvailable: false,
      includeCheck: true,
    });
    expect(withRight.members[0]?.check).toBeNull();

    const without = buildWorkload({
      open: [open("ann", "started", 3)],
      done: [done("ann", 2)],
      pointsAvailable: false,
      includeCheck: false,
    });
    expect(without.members[0]?.check).toBeNull();
  });

  it("ignores groups that are not open work", () => {
    const { members } = buildWorkload({
      open: [open("ann", "completed", 5), open("ann", "started", 1)],
      done: [],
      pointsAvailable: false,
      includeCheck: false,
    });
    expect(members[0]?.tasks).toBe(1);
  });
});
