import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  hasActiveFilters,
  parseBoardSearch,
  resolveBoardView,
  serializeBoardView,
  toggleValue,
  toTaskListQuery,
} from "./search-params";

const board = {
  board: {
    layouts: ["board", "list"] as Array<"board" | "list">,
    defaultLayout: "board" as const,
    comments: true,
    reactions: true,
    votes: true,
    requests: false,
    guestsAllowed: false,
    showAssignees: false,
    showBacklog: false,
  },
  columns: [
    {
      slug: "to-do",
      name: "To Do",
      icon: null,
      group: "unstarted",
      isFinal: false,
    },
    {
      slug: "done",
      name: "Done",
      icon: null,
      group: "completed",
      isFinal: true,
    },
  ],
  labels: [
    { name: "bug", color: "#f00" },
    { name: "ui", color: "#0f0" },
  ],
  sorts: ["manual", "newest", "votes"] as Array<
    "manual" | "newest" | "updated" | "dueDate" | "priority" | "votes"
  >,
};

describe("parseBoardSearch", () => {
  it("keeps strings, trims them and parses the task number", () => {
    expect(
      parseBoardSearch({
        layout: " list ",
        status: "to-do,done",
        q: "  login  ",
        task: "12",
      }),
    ).toEqual({ layout: "list", status: "to-do,done", q: "login", task: 12 });
  });

  it("drops malformed values instead of failing", () => {
    expect(
      parseBoardSearch({
        layout: 3,
        status: "",
        task: "-4",
        sort: { nested: true },
        q: "   ",
      }),
    ).toEqual({});
    expect(parseBoardSearch({ task: 0 })).toEqual({});
    expect(parseBoardSearch({ task: 2 ** 31 })).toEqual({});
    expect(parseBoardSearch({ task: "1.5" })).toEqual({});
    expect(parseBoardSearch({ task: 7 })).toEqual({ task: 7 });
  });

  it("caps the search text at 100 characters", () => {
    expect(parseBoardSearch({ q: "x".repeat(150) }).q).toHaveLength(100);
  });
});

describe("resolveBoardView", () => {
  it("drops unknown statuses, priorities, labels and sorts", () => {
    const view = resolveBoardView(
      {
        status: "to-do,planned,nope,to-do",
        priority: "high,critical",
        label: "bug,missing",
        sort: "chaos",
      },
      board,
    );
    expect(view.status).toEqual(["to-do"]);
    expect(view.priority).toEqual(["high"]);
    expect(view.label).toEqual(["bug"]);
    expect(view.sort).toBe("manual");
    expect(view.layout).toBe("board");
    expect(view.task).toBeNull();
  });

  it("falls back to the default layout when the layout is not allowed", () => {
    const listOnly = {
      ...board,
      board: {
        ...board.board,
        layouts: ["list"] as Array<"board" | "list">,
        defaultLayout: "list" as const,
      },
    };
    expect(resolveBoardView({ layout: "board" }, listOnly).layout).toBe("list");
    expect(resolveBoardView({ layout: "list" }, board).layout).toBe("list");
  });

  it("accepts the votes sort only when the board offers it", () => {
    expect(resolveBoardView({ sort: "votes" }, board).sort).toBe("votes");
    expect(
      resolveBoardView(
        { sort: "votes" },
        { ...board, sorts: ["manual", "newest"] },
      ).sort,
    ).toBe("manual");
  });
});

describe("serializeBoardView and toTaskListQuery", () => {
  const view = resolveBoardView(
    {
      layout: "list",
      status: "done",
      priority: "high,low",
      label: "ui",
      q: "login",
      sort: "newest",
      task: 3,
    },
    board,
  );

  it("round-trips through the URL", () => {
    const search = serializeBoardView(view, "board");
    expect(search).toEqual({
      layout: "list",
      status: "done",
      priority: "high,low",
      label: "ui",
      q: "login",
      sort: "newest",
      task: 3,
    });
    expect(resolveBoardView(parseBoardSearch(search), board)).toEqual(view);
  });

  it("leaves defaults out of the URL", () => {
    expect(serializeBoardView(resolveBoardView({}, board), "board")).toEqual(
      {},
    );
  });

  it("maps the view to the task list query without the peek or layout", () => {
    expect(toTaskListQuery(view)).toEqual({
      status: "done",
      priority: "high,low",
      label: "ui",
      q: "login",
      sort: "newest",
    });
    expect(toTaskListQuery(resolveBoardView({}, board))).toEqual({});
  });

  it("counts filters and toggles values", () => {
    expect(activeFilterCount(view)).toBe(4);
    expect(hasActiveFilters(resolveBoardView({ q: "x" }, board))).toBe(true);
    expect(hasActiveFilters(resolveBoardView({}, board))).toBe(false);
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });
});
