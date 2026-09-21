import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_PROPERTIES,
  defaultDisplay,
  isClassicDisplay,
  normalizeDisplay,
  normalizeDisplayProperties,
  toSortConfig,
  withPreferences,
} from "./display";

const preferences = {
  showTaskNumbers: false,
  showPriority: true,
  showAssignees: false,
  showLabels: true,
  showDueDates: false,
  showEstimates: true,
  showTaskItemCounts: false,
};

describe("task display", () => {
  it("defaults per scope", () => {
    expect(defaultDisplay("project")).toMatchObject({
      groupBy: "status",
      orderBy: { field: "manual", direction: "asc" },
      layout: "list",
    });
    expect(defaultDisplay("workspace")).toMatchObject({
      groupBy: null,
      orderBy: { field: "createdAt", direction: "desc" },
      layout: "spreadsheet",
    });
  });

  it("normalizes stored display defensively", () => {
    expect(normalizeDisplay("junk", "project")).toEqual(
      defaultDisplay("project"),
    );
    expect(
      normalizeDisplay(
        {
          layout: "calendar",
          groupBy: "priority",
          subGroupBy: "priority",
          orderBy: { field: "dueDate" },
          showSubTasks: false,
        },
        "project",
      ),
    ).toEqual({
      layout: "calendar",
      groupBy: "priority",
      subGroupBy: null,
      orderBy: { field: "dueDate", direction: "asc" },
      showSubTasks: false,
      showEmptyGroups: false,
    });
  });

  it("never groups a workspace list by status", () => {
    expect(
      normalizeDisplay({ groupBy: "status", layout: "calendar" }, "workspace", [
        "list",
        "board",
        "spreadsheet",
      ]),
    ).toMatchObject({ groupBy: null, layout: "spreadsheet" });
  });

  it("drops unknown display properties", () => {
    const normalized = normalizeDisplayProperties({
      key: false,
      linkCount: true,
      bogus: true,
      customFields: ["f1", "f1", 3, ""],
    });
    expect(normalized.key).toBe(false);
    expect(normalized.priority).toBe(true);
    expect(normalized).not.toHaveProperty("linkCount");
    expect(normalized).not.toHaveProperty("bogus");
    expect(normalized.customFields).toEqual(["f1"]);
  });

  it("reads mirrored properties from the global toggles", () => {
    const merged = withPreferences(
      { ...DEFAULT_DISPLAY_PROPERTIES, startDate: true },
      preferences,
    );
    expect(merged.key).toBe(false);
    expect(merged.assignee).toBe(false);
    expect(merged.dueDate).toBe(false);
    expect(merged.checklist).toBe(false);
    expect(merged.estimate).toBe(true);
    // Properties without a toggle keep their own value.
    expect(merged.startDate).toBe(true);
  });

  it("keeps the classic board only for its own grouping and orders", () => {
    const display = defaultDisplay("project");
    expect(isClassicDisplay(display, "exclude")).toBe(true);
    expect(isClassicDisplay(display, "only")).toBe(false);
    expect(
      isClassicDisplay({ ...display, groupBy: "priority" }, "exclude"),
    ).toBe(false);
    expect(
      isClassicDisplay({ ...display, subGroupBy: "priority" }, "exclude"),
    ).toBe(false);
    expect(
      isClassicDisplay(
        { ...display, orderBy: { field: "updatedAt", direction: "desc" } },
        "exclude",
      ),
    ).toBe(false);
  });

  it("maps the engine order to the board sort", () => {
    expect(toSortConfig({ field: "manual", direction: "asc" })).toEqual({
      field: "position",
      direction: "asc",
    });
    expect(toSortConfig({ field: "priority", direction: "desc" })).toEqual({
      field: "priority",
      direction: "desc",
    });
  });
});
