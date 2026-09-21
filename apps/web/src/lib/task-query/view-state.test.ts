import { describe, expect, it } from "vitest";
import type { SavedView } from "@/types/view";
import { DEFAULT_DISPLAY_PROPERTIES } from "./display";
import { stateToViewContent, viewToState } from "./view-state";

const root = {
  op: "and" as const,
  children: [{ key: "priority", operator: "in", values: ["high"] }],
};

function view(overrides: Partial<SavedView> = {}) {
  return {
    projectId: "p1",
    filters: { version: 1 as const, root, archived: "include" as const },
    display: {
      layout: "board" as const,
      groupBy: "priority" as const,
      subGroupBy: null,
      orderBy: { field: "dueDate" as const, direction: "asc" as const },
      showSubTasks: false,
      showEmptyGroups: true,
    },
    displayProperties: {
      ...DEFAULT_DISPLAY_PROPERTIES,
      linkCount: false,
      attachmentCount: false,
      customFields: ["f1"],
    },
    ...overrides,
  } as Pick<
    SavedView,
    "projectId" | "filters" | "display" | "displayProperties"
  >;
}

describe("view state", () => {
  it("opens a view with its filters, display and properties", () => {
    const state = viewToState(view());
    expect(state.filters).toEqual(root);
    expect(state.archived).toBe("include");
    expect(state.display).toMatchObject({
      layout: "board",
      groupBy: "priority",
      showSubTasks: false,
      showEmptyGroups: true,
    });
    expect(state.displayProperties.customFields).toEqual(["f1"]);
    expect(state.displayProperties).not.toHaveProperty("linkCount");
  });

  it("saves the state as view content", () => {
    const content = stateToViewContent(viewToState(view()), "project");
    expect(content.filters).toEqual({ version: 1, root, archived: "include" });
    expect(content.display.groupBy).toBe("priority");
    expect(content.displayProperties.customFields).toEqual(["f1"]);
  });

  it("keeps workspace views within their layouts and without custom fields", () => {
    const state = viewToState(view({ projectId: null }));
    const content = stateToViewContent(
      { ...state, display: { ...state.display, layout: "gantt" } },
      "workspace",
    );
    expect(content.display.layout).toBe("spreadsheet");
    expect(content.displayProperties.customFields).toEqual([]);
  });
});
