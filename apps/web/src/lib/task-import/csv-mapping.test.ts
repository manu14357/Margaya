import { describe, expect, it } from "vitest";
import {
  autoMap,
  type ColumnMapping,
  emptyMapping,
  type ImportContext,
  normalizeHeader,
  resolveRows,
  splitList,
} from "./csv-mapping";

const context: ImportContext = {
  columns: [
    { slug: "to-do", name: "To do" },
    { slug: "in-progress", name: "In progress" },
    { slug: "done", name: "Done" },
  ],
  members: [
    { id: "u-ada", name: "Ada Lovelace", email: "ada@example.com" },
    { id: "u-sam1", name: "Sam", email: "sam1@example.com" },
    { id: "u-sam2", name: "sam", email: "sam2@example.com" },
  ],
  labels: [{ name: "Bug" }],
  cycles: [{ id: "c-1", name: "Sprint 1" }],
  modules: [
    { id: "m-web", name: "Web" },
    { id: "m-api", name: "API" },
  ],
  estimatePoints: [
    { id: "p-1", value: "1" },
    { id: "p-3", value: "3" },
    { id: "p-xl", value: "XL" },
  ],
  dateFormat: "auto",
};

function mapping(fields: Partial<ColumnMapping>): ColumnMapping {
  return { ...emptyMapping(), ...fields };
}

describe("autoMap", () => {
  it("normalizes headers", () => {
    expect(normalizeHeader("  Due-Date: ")).toBe("due date");
    expect(normalizeHeader("Assigned_To")).toBe("assigned to");
  });

  it("maps every field from its accepted names", () => {
    const headers = [
      "Summary",
      "Notes",
      "State",
      "Priority",
      "Assigned to",
      "Tags",
      "Start",
      "Deadline",
      "Story Points",
      "Sprint",
      "Epic",
      "Unknown",
    ];
    expect(autoMap(headers)).toEqual({
      title: 0,
      description: 1,
      status: 2,
      priority: 3,
      assignees: 4,
      labels: 5,
      startDate: 6,
      dueDate: 7,
      estimate: 8,
      cycle: 9,
      modules: 10,
    });
  });

  it("prefers the more specific name and leaves the rest unmapped", () => {
    const result = autoMap(["Name", "Title", "Assignee", "Assignee Emails"]);
    expect(result.title).toBe(1);
    expect(result.assignees).toBe(3);
    expect(result.status).toBeNull();
  });

  it("maps only the offered fields", () => {
    const result = autoMap(["Title", "Sprint"], ["title", "status"]);
    expect(result).toEqual(mapping({ title: 0 }));
  });
});

describe("splitList", () => {
  it("splits, trims and drops blanks", () => {
    expect(splitList(" a, b;;c ,", /[,;]/)).toEqual(["a", "b", "c"]);
  });
});

describe("resolveRows", () => {
  it("skips rows without a title by row number and ignores blank rows", () => {
    const result = resolveRows(
      [["A"], ["", "x"], ["", ""], ["B"]],
      mapping({ title: 0 }),
      context,
    );
    expect(result.tasks).toEqual([
      { row: 2, task: { title: "A", status: "planned" } },
      { row: 5, task: { title: "B", status: "planned" } },
    ]);
    expect(result.skipped).toEqual([3]);
  });

  it("sends statuses as typed and reports the unmatched ones", () => {
    const result = resolveRows(
      [
        ["A", "done"],
        ["B", "in progress"],
        ["C", "Blocked"],
        ["D", "blocked"],
        ["E", ""],
      ],
      mapping({ title: 0, status: 1 }),
      context,
    );
    expect(result.tasks.map((entry) => entry.task.status)).toEqual([
      "done",
      "in progress",
      "Blocked",
      "blocked",
      "planned",
    ]);
    expect(result.unmatched.status).toEqual(["Blocked"]);
  });

  it("normalizes priorities", () => {
    const result = resolveRows(
      [
        ["A", "HIGH"],
        ["B", "No priority"],
        ["C", "none"],
        ["D", ""],
        ["E", "p1"],
      ],
      mapping({ title: 0, priority: 1 }),
      context,
    );
    expect(result.tasks.map((entry) => entry.task.priority)).toEqual([
      "high",
      "no-priority",
      "no-priority",
      "no-priority",
      "p1",
    ]);
  });

  it("resolves members by email, then by a unique name", () => {
    const result = resolveRows(
      [
        ["A", "ADA@example.com; sam1@example.com"],
        ["B", "ada lovelace, Ada Lovelace"],
        ["C", "Sam, Grace"],
      ],
      mapping({ title: 0, assignees: 1 }),
      context,
    );
    expect(result.tasks.map((entry) => entry.task.assigneeIds)).toEqual([
      ["u-ada", "u-sam1"],
      ["u-ada"],
      undefined,
    ]);
    // "Sam" matches two members, so it is ambiguous and dropped.
    expect(result.unmatched.assignees).toEqual(["Sam", "Grace"]);
  });

  it("splits labels and detects new ones", () => {
    const result = resolveRows(
      [
        ["A", "bug, Frontend , frontend"],
        ["B", "FRONTEND,Docs"],
      ],
      mapping({ title: 0, labels: 1 }),
      context,
    );
    expect(result.tasks.map((entry) => entry.task.labels)).toEqual([
      ["bug", "Frontend"],
      ["FRONTEND", "Docs"],
    ]);
    expect(result.newLabels).toEqual(["Frontend", "Docs"]);
  });

  it("reads dates with the detected or chosen order and reports others", () => {
    const rows = [
      ["A", "03/04/2026", "25/04/2026"],
      ["B", "2026-05-01", "soon"],
    ];
    const auto = resolveRows(
      rows,
      mapping({ title: 0, startDate: 1, dueDate: 2 }),
      context,
    );
    const start = new Date(auto.tasks[0]?.task.startDate ?? "");
    expect([start.getMonth() + 1, start.getDate()]).toEqual([4, 3]);
    expect(auto.tasks[1]?.task.startDate).toBeDefined();
    expect(auto.tasks[1]?.task.dueDate).toBeUndefined();
    expect(auto.unmatched.dates).toEqual(["soon"]);

    const ambiguous = resolveRows(
      [["A", "03/04/2026"]],
      mapping({ title: 0, dueDate: 1 }),
      context,
    );
    expect(ambiguous.unmatched.dates).toEqual(["03/04/2026"]);

    const chosen = resolveRows(
      [["A", "03/04/2026"]],
      mapping({ title: 0, dueDate: 1 }),
      { ...context, dateFormat: "mdy" },
    );
    const due = new Date(chosen.tasks[0]?.task.dueDate ?? "");
    expect([due.getMonth() + 1, due.getDate()]).toEqual([3, 4]);
  });

  it("resolves estimate, cycle and modules by name", () => {
    const result = resolveRows(
      [
        ["A", "3.0", "sprint 1", "web, Api"],
        ["B", "xl", "Sprint 9", "Mobile, web"],
        ["C", "5", "", ""],
      ],
      mapping({ title: 0, estimate: 1, cycle: 2, modules: 3 }),
      context,
    );
    expect(result.tasks.map((entry) => entry.task)).toEqual([
      {
        title: "A",
        status: "planned",
        estimatePointId: "p-3",
        cycleId: "c-1",
        moduleIds: ["m-web", "m-api"],
      },
      {
        title: "B",
        status: "planned",
        estimatePointId: "p-xl",
        moduleIds: ["m-web"],
      },
      { title: "C", status: "planned" },
    ]);
    expect(result.unmatched.estimate).toEqual(["5"]);
    expect(result.unmatched.cycle).toEqual(["Sprint 9"]);
    expect(result.unmatched.modules).toEqual(["Mobile"]);
  });

  it("numbers rows from 1 without a header", () => {
    const result = resolveRows([["", "x"]], mapping({ title: 0 }), context, 1);
    expect(result.skipped).toEqual([1]);
  });
});
