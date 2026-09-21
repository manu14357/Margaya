import { describe, expect, it } from "vitest";
import {
  allFamiliesSelection,
  describePatterns,
  familyState,
  hasAnySelection,
  patternsFromSelection,
  samePatterns,
  selectionFromPatterns,
  toggleEvent,
  toggleFamily,
} from "./patterns";

const catalog = {
  families: [
    {
      key: "task",
      events: [
        { name: "task.created" },
        { name: "task.deleted" },
        { name: "task.status_changed" },
      ],
    },
    {
      key: "comment",
      events: [{ name: "comment.created" }, { name: "comment.deleted" }],
    },
  ],
};
const [task, comment] = catalog.families;

describe("selectionFromPatterns / patternsFromSelection", () => {
  it("round-trips everything", () => {
    const selection = selectionFromPatterns(["*"], catalog);
    expect(selection.mode).toBe("all");
    expect(patternsFromSelection(selection, catalog)).toEqual(["*"]);
  });

  it("round-trips a family pattern and single events", () => {
    const patterns = ["comment.created", "task.*"];
    const selection = selectionFromPatterns(patterns, catalog);
    expect(familyState(selection, task)).toBe("checked");
    expect(familyState(selection, comment)).toBe("indeterminate");
    expect(patternsFromSelection(selection, catalog)).toEqual(patterns);
  });

  it("collapses a fully checked family to family.*", () => {
    const selection = selectionFromPatterns(
      ["task.created", "task.deleted", "task.status_changed"],
      catalog,
    );
    expect(patternsFromSelection(selection, catalog)).toEqual(["task.*"]);
  });

  it("collapses every family checked to *", () => {
    const selection = selectionFromPatterns(
      ["task.*", "comment.created", "comment.deleted"],
      catalog,
    );
    expect(patternsFromSelection(selection, catalog)).toEqual(["*"]);
  });

  it("keeps unknown patterns through a round trip", () => {
    const selection = selectionFromPatterns(
      ["future.*", "task.created", "task.renamed"],
      catalog,
    );
    expect(selection.unknown).toEqual(["future.*", "task.renamed"]);
    expect(patternsFromSelection(selection, catalog)).toEqual([
      "future.*",
      "task.created",
      "task.renamed",
    ]);
  });

  it("dedupes and sorts like the server", () => {
    const selection = selectionFromPatterns(
      ["task.deleted", "task.created", "task.created"],
      catalog,
    );
    expect(patternsFromSelection(selection, catalog)).toEqual([
      "task.created",
      "task.deleted",
    ]);
  });
});

describe("toggles", () => {
  it("checks and unchecks a whole family", () => {
    const empty = selectionFromPatterns([], catalog);
    const checked = toggleFamily(empty, "task", true);
    expect(patternsFromSelection(checked, catalog)).toEqual(["task.*"]);
    const cleared = toggleFamily(checked, "task", false);
    expect(patternsFromSelection(cleared, catalog)).toEqual([]);
    expect(hasAnySelection(cleared)).toBe(false);
  });

  it("unchecking one event of a full family keeps the others", () => {
    const full = selectionFromPatterns(["task.*"], catalog);
    const next = toggleEvent(full, task, "task.deleted", false);
    expect(familyState(next, task)).toBe("indeterminate");
    expect(patternsFromSelection(next, catalog)).toEqual([
      "task.created",
      "task.status_changed",
    ]);
  });

  it("unchecking an event while everything is selected expands the rest", () => {
    const next = toggleEvent(
      allFamiliesSelection(catalog),
      comment,
      "comment.deleted",
      false,
    );
    expect(patternsFromSelection(next, catalog)).toEqual([
      "comment.created",
      "task.*",
    ]);
  });

  it("checking the last missing event marks the family checked", () => {
    const partial = selectionFromPatterns(["comment.created"], catalog);
    const next = toggleEvent(partial, comment, "comment.deleted", true);
    expect(familyState(next, comment)).toBe("checked");
  });
});

describe("describePatterns", () => {
  it("reports all events", () => {
    expect(describePatterns(["*"], catalog)).toEqual({ kind: "all" });
  });

  it("counts the events a family pattern covers", () => {
    expect(describePatterns(["task.*", "comment.created"], catalog)).toEqual({
      kind: "count",
      count: 4,
    });
  });

  it("counts patterns without a catalog", () => {
    expect(describePatterns(["task.*", "comment.created"])).toEqual({
      kind: "count",
      count: 2,
    });
  });
});

describe("samePatterns", () => {
  it("ignores order and duplicates", () => {
    expect(samePatterns(["b", "a"], ["a", "b", "a"])).toBe(true);
    expect(samePatterns(["a"], ["a", "b"])).toBe(false);
  });
});
