import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_PROPERTIES } from "@/lib/task-query/display";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import QueryTaskRow from "./query-task-row";

// A cross-project list (Your work, workspace views): the row's menu acts in
// the row's own project, so that project's role decides what it offers.

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./use-task-open", () => ({ useTaskOpen: () => vi.fn() }));
vi.mock("./delete-task-dialog", () => ({ default: () => null }));
vi.mock("@/components/bulk-selection/selection-checkbox", () => ({
  SelectionCheckbox: () => null,
  useCanBulkSelect: () => false,
}));
// The menu renders in place, so the scope it sees can be read.
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock(
  "@/components/kanban-board/task-card-context-menu/task-card-context-menu-content",
  async () => {
    const { useProjectScope } = await import("@/hooks/use-project-scope");
    return {
      default: () => <output>{`menu in ${useProjectScope()}`}</output>,
    };
  },
);

afterEach(() => cleanup());

const meta = {
  users: [],
  projects: [],
  columns: [],
  labels: [],
  cycles: [],
  modules: [],
  estimatePoints: [],
  customFields: [],
} as unknown as TaskQueryMeta;

const row = (id: string, projectId: string) =>
  ({
    id,
    projectId,
    number: 1,
    key: `K-${id}`,
    title: `Task ${id}`,
    status: "to-do",
    columnId: null,
    group: "unstarted",
    priority: "low",
    startDate: null,
    dueDate: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    completedAt: null,
    archivedAt: null,
    createdBy: null,
    userId: null,
    position: 0,
    assigneeIds: [],
  }) as unknown as TaskQueryRow;

describe("QueryTaskRow", () => {
  it("scopes each row's menu to its own task's project", () => {
    render(
      <>
        <QueryTaskRow
          row={row("a", "project-a")}
          meta={meta}
          properties={DEFAULT_DISPLAY_PROPERTIES}
          workspaceId="ws-1"
        />
        <QueryTaskRow
          row={row("b", "project-b")}
          meta={meta}
          properties={DEFAULT_DISPLAY_PROPERTIES}
          workspaceId="ws-1"
        />
      </>,
    );
    expect(screen.getByText("menu in project-a")).toBeInTheDocument();
    expect(screen.getByText("menu in project-b")).toBeInTheDocument();
  });
});
