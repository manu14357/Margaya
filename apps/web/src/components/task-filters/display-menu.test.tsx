import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DISPLAY_PROPERTIES,
  defaultDisplay,
} from "@/lib/task-query/display";
import DisplayMenu, { type DisplayMenuConfig } from "./display-menu";
import { useDisplayConfig } from "./use-display-config";

const projects = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: projects.list }),
}));

vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: (projectId: string) => ({
      data: projectId ? [{ id: "f1", name: "Team" }] : undefined,
    }),
  }),
);

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  projects.list = [];
});

const config: DisplayMenuConfig = {
  groupByOptions: ["status", "priority"],
  allowSubGroup: true,
  allowEmptyGroups: true,
  orderOptions: ["manual", "priority"],
  propertyKeys: ["key", "priority", "assignee"],
  propertiesTitle: "properties",
};

function openMenu(groupBy: "priority" | null, onPropertyChange = vi.fn()) {
  render(
    <DisplayMenu
      display={{ ...defaultDisplay("project"), groupBy }}
      onDisplayChange={vi.fn()}
      displayProperties={{ ...DEFAULT_DISPLAY_PROPERTIES, customFields: [] }}
      onPropertyChange={onPropertyChange}
      config={config}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /tasks:display.button/ }));
}

describe("DisplayMenu", () => {
  it("disables sub-grouping without a group", async () => {
    openMenu(null);
    const triggers = await screen.findAllByRole("combobox");
    // Group by, sub-group by, order by.
    expect(triggers).toHaveLength(3);
    expect(triggers[1]).toHaveAttribute("data-disabled");
  });

  it("names each select by its row label", async () => {
    openMenu("priority");
    for (const label of [
      "tasks:display.groupBy",
      "tasks:display.subGroupBy",
      "tasks:display.orderBy",
    ]) {
      expect(
        await screen.findByRole("combobox", { name: label }),
      ).toBeInTheDocument();
    }
  });

  it("toggles a property", async () => {
    const onPropertyChange = vi.fn();
    openMenu("priority", onPropertyChange);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "tasks:display.props.assignee",
      }),
    );
    expect(onPropertyChange).toHaveBeenCalledWith("assignee", false);
  });
});

describe("useDisplayConfig", () => {
  it("offers status only for one project and project only for the workspace", () => {
    projects.list = [
      { id: "p1", cyclesEnabled: false, modulesEnabled: true },
      { id: "p2", cyclesEnabled: true, modulesEnabled: false },
    ];
    const project = renderHook(() =>
      useDisplayConfig({
        workspaceId: "w1",
        scope: { kind: "project", projectId: "p1" },
        layout: "board",
      }),
    ).result.current;
    expect(project.groupByOptions).toContain("status");
    expect(project.groupByOptions).not.toContain("project");
    // Cycles are off in p1.
    expect(project.groupByOptions).not.toContain("cycle");
    expect(project.propertyKeys).not.toContain("cycle");

    const workspace = renderHook(() =>
      useDisplayConfig({
        workspaceId: "w1",
        scope: { kind: "workspace" },
        layout: "list",
      }),
    ).result.current;
    expect(workspace.groupByOptions).not.toContain("status");
    expect(workspace.groupByOptions).toEqual(
      expect.arrayContaining(["project", "cycle", "module"]),
    );
    expect(workspace.orderOptions).not.toContain("manual");
  });

  it("offers a project's custom fields to group and order by", () => {
    projects.list = [{ id: "p1" }];
    const board = renderHook(() =>
      useDisplayConfig({
        workspaceId: "w1",
        scope: { kind: "project", projectId: "p1" },
        layout: "board",
      }),
    ).result.current;
    expect(board.groupByOptions).toContain("customField:f1");
    expect(board.orderOptions).toContain("customField:f1");
    expect(board.displayFields).toEqual([{ id: "f1", name: "Team" }]);

    const calendar = renderHook(() =>
      useDisplayConfig({
        workspaceId: "w1",
        scope: { kind: "project", projectId: "p1" },
        layout: "calendar",
      }),
    ).result.current;
    expect(calendar.groupByOptions).not.toContain("customField:f1");

    const classicOnly = renderHook(() =>
      useDisplayConfig({
        workspaceId: "w1",
        scope: { kind: "project", projectId: "p1" },
        layout: "board",
        classicOnly: true,
      }),
    ).result.current;
    expect(classicOnly.orderOptions).not.toContain("customField:f1");

    const workspace = renderHook(() =>
      useDisplayConfig({
        workspaceId: "w1",
        scope: { kind: "workspace" },
        layout: "list",
      }),
    ).result.current;
    expect(workspace.groupByOptions).not.toContain("customField:f1");
    expect(workspace.orderOptions).not.toContain("customField:f1");
  });

  it("names spreadsheet columns and offers custom fields in a project", () => {
    projects.list = [{ id: "p1" }];
    const spreadsheet = renderHook(() =>
      useDisplayConfig({
        workspaceId: "w1",
        scope: { kind: "project", projectId: "p1" },
        layout: "spreadsheet",
      }),
    ).result.current;
    expect(spreadsheet.groupByOptions).toEqual([]);
    expect(spreadsheet.propertiesTitle).toBe("columns");
    expect(spreadsheet.propertyKeys).not.toContain("checklist");
    expect(spreadsheet.customFields).toEqual([{ id: "f1", name: "Team" }]);
  });

  it("keeps cycle and module boards on the classic order", () => {
    projects.list = [{ id: "p1" }];
    const classic = renderHook(() =>
      useDisplayConfig({
        workspaceId: "w1",
        scope: { kind: "project", projectId: "p1" },
        layout: "board",
        classicOnly: true,
      }),
    ).result.current;
    expect(classic.groupByOptions).toEqual([]);
    expect(classic.allowSubGroup).toBe(false);
    expect(classic.orderOptions).not.toContain("updatedAt");
  });
});
