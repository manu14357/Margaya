import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  COLUMN_GROUP_RANK,
  isClosedGroup,
  isCompletedGroup,
  isOpenGroup,
  resolveColumnGroupForCreate,
  resolveColumnGroupForUpdate,
} from "../../../apps/api/src/column/groups";
import {
  completedColumn,
  entryColumn,
  progressPercent,
  resolveCompletedAt,
  taskGroupOf,
} from "../../../apps/api/src/task/scope";

function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof HTTPException) {
      return { status: error.status, message: error.message };
    }
    throw error;
  }
  throw new Error("expected an HTTPException");
}

describe("column group input on create", () => {
  it("uses the group and derives isFinal from it", () => {
    expect(resolveColumnGroupForCreate({ group: "started" })).toEqual({
      group: "started",
      isFinal: false,
    });
    expect(resolveColumnGroupForCreate({ group: "cancelled" })).toEqual({
      group: "cancelled",
      isFinal: true,
    });
  });

  it("maps isFinal alone to completed or not started", () => {
    expect(resolveColumnGroupForCreate({ isFinal: true })).toEqual({
      group: "completed",
      isFinal: true,
    });
    expect(resolveColumnGroupForCreate({ isFinal: false })).toEqual({
      group: "unstarted",
      isFinal: false,
    });
    expect(resolveColumnGroupForCreate({})).toEqual({
      group: "unstarted",
      isFinal: false,
    });
  });

  it("accepts a consistent pair and rejects a contradiction", () => {
    expect(
      resolveColumnGroupForCreate({ group: "completed", isFinal: true }),
    ).toEqual({ group: "completed", isFinal: true });
    expect(
      rejection(() =>
        resolveColumnGroupForCreate({ group: "started", isFinal: true }),
      ),
    ).toEqual({ status: 400, message: "isFinal must match the column group" });
  });

  it("rejects the reserved triage group", () => {
    expect(
      rejection(() => resolveColumnGroupForCreate({ group: "triage" })),
    ).toEqual({
      status: 400,
      message: "The triage group is reserved for intake",
    });
  });
});

describe("column group input on update", () => {
  it("keeps the current group when nothing group-related is sent", () => {
    expect(resolveColumnGroupForUpdate("started", {})).toEqual({
      group: "started",
      isFinal: false,
    });
  });

  it("isFinal true keeps a closed group and completes an open one", () => {
    expect(resolveColumnGroupForUpdate("cancelled", { isFinal: true })).toEqual(
      { group: "cancelled", isFinal: true },
    );
    expect(resolveColumnGroupForUpdate("backlog", { isFinal: true })).toEqual({
      group: "completed",
      isFinal: true,
    });
  });

  it("isFinal false keeps an open group and turns a closed one into started", () => {
    expect(resolveColumnGroupForUpdate("backlog", { isFinal: false })).toEqual({
      group: "backlog",
      isFinal: false,
    });
    expect(
      resolveColumnGroupForUpdate("completed", { isFinal: false }),
    ).toEqual({ group: "started", isFinal: false });
  });

  it("an explicit group wins and is validated like on create", () => {
    expect(
      resolveColumnGroupForUpdate("completed", { group: "cancelled" }),
    ).toEqual({ group: "cancelled", isFinal: true });
    expect(
      rejection(() =>
        resolveColumnGroupForUpdate("started", {
          group: "backlog",
          isFinal: true,
        }),
      ).status,
    ).toBe(400);
  });
});

describe("group predicates", () => {
  it("classifies open and closed groups", () => {
    expect(isClosedGroup("completed")).toBe(true);
    expect(isClosedGroup("cancelled")).toBe(true);
    expect(isClosedGroup("started")).toBe(false);
    expect(isClosedGroup("triage")).toBe(false);
    expect(isCompletedGroup("completed")).toBe(true);
    expect(isCompletedGroup("cancelled")).toBe(false);
    expect(isOpenGroup("backlog")).toBe(true);
    expect(isOpenGroup("triage")).toBe(false);
  });

  it("ranks groups in the fixed aggregation order", () => {
    const ordered = Object.entries(COLUMN_GROUP_RANK)
      .sort(([, a], [, b]) => a - b)
      .map(([group]) => group);
    expect(ordered).toEqual([
      "triage",
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]);
  });
});

describe("task group resolution", () => {
  it("uses the column group and planned as backlog", () => {
    expect(taskGroupOf("done", { group: "completed" })).toBe("completed");
    expect(taskGroupOf("planned", null)).toBe("backlog");
    expect(taskGroupOf("gone", undefined)).toBe("unstarted");
  });

  it("has no archived group: archiving is task.archivedAt (D7)", () => {
    // The legacy status never reaches storage; as a slug it has no column.
    expect(taskGroupOf("archived", null)).toBe("unstarted");
  });
});

describe("resolveCompletedAt", () => {
  const earlier = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-02-01T00:00:00.000Z");

  it("stamps now on entering completed and keeps an existing timestamp", () => {
    expect(resolveCompletedAt(null, "completed", now)).toBe(now);
    expect(resolveCompletedAt(earlier, "completed", now)).toBe(earlier);
  });

  it("clears it for every other group", () => {
    for (const group of [
      "backlog",
      "unstarted",
      "started",
      "cancelled",
      "triage",
    ] as const) {
      expect(resolveCompletedAt(earlier, group, now)).toBeNull();
    }
  });
});

describe("progressPercent", () => {
  it("divides completed by visible minus cancelled, rounded", () => {
    expect(progressPercent({ completed: 1, cancelled: 1, visible: 4 })).toBe(
      33,
    );
    expect(progressPercent({ completed: 2, cancelled: 0, visible: 4 })).toBe(
      50,
    );
  });

  it("handles the empty and all-cancelled edges", () => {
    expect(progressPercent({ completed: 0, cancelled: 0, visible: 0 })).toBe(0);
    expect(progressPercent({ completed: 0, cancelled: 3, visible: 3 })).toBe(
      100,
    );
  });
});

describe("entry and completed columns", () => {
  const column = (id: string, position: number, group: string) =>
    ({ id, position, group }) as {
      id: string;
      position: number;
      group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
    };

  it("prefers the first not-started column by position", () => {
    const columns = [
      column("b", 1, "unstarted"),
      column("a", 0, "backlog"),
      column("c", 2, "unstarted"),
    ];
    expect(entryColumn(columns)?.id).toBe("b");
  });

  it("falls back to the first open column, then none", () => {
    expect(
      entryColumn([column("s", 1, "started"), column("d", 0, "completed")])?.id,
    ).toBe("s");
    expect(entryColumn([column("d", 0, "completed")])).toBeNull();
  });

  it("finds the first completed column even after a cancelled one", () => {
    const columns = [
      column("x", 0, "cancelled"),
      column("d2", 3, "completed"),
      column("d1", 2, "completed"),
    ];
    expect(completedColumn(columns)?.id).toBe("d1");
    expect(completedColumn([column("x", 0, "cancelled")])).toBeNull();
  });
});
