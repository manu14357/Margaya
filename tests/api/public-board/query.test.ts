import { describe, expect, it } from "vitest";
import {
  boardSorts,
  boardTaskQuery,
  publicTaskRow,
  VOTES_SORT_OFF,
} from "../../../apps/api/src/public-board/query";

const BOARD = {
  workspaceId: "w1",
  projectId: "p1",
  showBacklog: false,
  votesEnabled: false,
  columnSlugs: ["to-do", "in-progress", "done"],
};

const HIDE_PLANNED = { key: "status", operator: "notIn", values: ["planned"] };

describe("public task list query", () => {
  it("fixes scope, archive, grouping, includes and time zone", () => {
    const request = boardTaskQuery(BOARD, {});
    expect(request).toMatchObject({
      workspaceId: "w1",
      scope: { projectIds: ["p1"] },
      archived: "exclude",
      display: {
        groupBy: "status",
        orderBy: { field: "manual", direction: "asc" },
        showSubTasks: true,
        showEmptyGroups: true,
      },
      include: ["labels"],
      page: { limit: 50 },
      context: { timeZone: "UTC" },
    });
    // Without the backlog, planned tasks are hidden by a fixed condition.
    expect(request.filters).toEqual(HIDE_PLANNED);
  });

  it("maps every parameter and drops unknown values", () => {
    const request = boardTaskQuery(
      { ...BOARD, showBacklog: true },
      {
        status: "to-do, planned,nope,done,to-do",
        priority: "high,bogus,urgent",
        label: `bug,${"x".repeat(65)},ui`,
        q: `  ${"s".repeat(150)}  `,
        sort: "newest",
        group: "to-do",
        cursor: "abc",
        limit: 500,
      },
    );
    expect(request.filters).toEqual({
      op: "and",
      children: [
        {
          key: "status",
          operator: "in",
          values: ["to-do", "planned", "done"],
        },
        { key: "priority", operator: "in", values: ["high", "urgent"] },
        { key: "label", operator: "in", values: ["name:bug", "name:ui"] },
      ],
    });
    expect(request.search).toHaveLength(100);
    expect(request.display?.orderBy).toEqual({
      field: "createdAt",
      direction: "desc",
    });
    expect(request.page).toEqual({ limit: 100, group: "to-do", cursor: "abc" });
  });

  it("only offers planned with the backlog shown", () => {
    expect(boardTaskQuery(BOARD, { status: "planned" }).filters).toEqual(
      HIDE_PLANNED,
    );
  });

  it("sorts by votes only when votes are on", () => {
    expect(() => boardTaskQuery(BOARD, { sort: "votes" })).toThrow(
      VOTES_SORT_OFF,
    );
    expect(
      boardTaskQuery({ ...BOARD, votesEnabled: true }, { sort: "votes" })
        .display?.orderBy,
    ).toEqual({ field: "voteScore", direction: "desc" });
    expect(
      boardTaskQuery(BOARD, { sort: "drop table" }).display?.orderBy,
    ).toEqual({ field: "manual", direction: "asc" });
    expect(boardSorts(false)).not.toContain("votes");
    expect(boardSorts(true)).toContain("votes");
  });

  it("maps engine rows without ids or emails of people", () => {
    const row = {
      id: "t1",
      projectId: "p1",
      number: 7,
      key: "WEB-7",
      title: "Dark mode",
      status: "to-do",
      priority: "high",
      dueDate: null,
      startDate: null,
      createdBy: "user-secret-1",
      userId: "user-secret-2",
      assigneeIds: ["user-secret-2"],
      labels: [{ name: "ui", color: "#fff", id: "label-1" }],
      customFieldValues: [{ fieldId: "f", value: "internal" }],
    };
    const mapped = publicTaskRow(row, {
      assignees: [{ name: "Ben", image: null }],
      counts: {
        votes: { up: 3, down: 1 },
        reactions: [{ emoji: "heart", count: 2 }],
        comments: 4,
      },
    });
    expect(mapped).toEqual({
      id: "t1",
      number: 7,
      key: "WEB-7",
      title: "Dark mode",
      status: "to-do",
      priority: "high",
      dueDate: null,
      startDate: null,
      labels: [{ name: "ui", color: "#fff" }],
      assignees: [{ name: "Ben", image: null }],
      counts: {
        votesUp: 3,
        votesDown: 1,
        reactions: [{ emoji: "heart", count: 2 }],
        comments: 4,
      },
    });
    expect(JSON.stringify(mapped)).not.toContain("user-secret");
    expect(JSON.stringify(mapped)).not.toContain("internal");
    expect(publicTaskRow(row, { counts: {} })).not.toHaveProperty("assignees");
    expect(publicTaskRow(row, { counts: {} }).counts).toEqual({});
  });
});
