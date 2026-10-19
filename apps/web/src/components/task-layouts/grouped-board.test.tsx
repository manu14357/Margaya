import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGroupMove } from "@/hooks/mutations/task-query/use-move-task-to-group";
import type { TaskQueryHandle } from "@/hooks/queries/task-query/use-task-query";
import { DEFAULT_DISPLAY_PROPERTIES } from "@/lib/task-query/display";
import type { MergedTaskQueryResult } from "@/lib/task-query/merge";
import type Task from "@/types/task";
import GroupedBoard from "./grouped-board";

const api = vi.hoisted(() => ({
  bulk: vi.fn(),
  priority: vi.fn(),
  status: vi.fn(),
  cycle: vi.fn(),
  modules: vi.fn(),
}));

vi.mock("@/fetchers/task/bulk-operation", () => ({ default: api.bulk }));
vi.mock("@/fetchers/task/update-task-priority", () => ({
  default: api.priority,
}));
vi.mock("@/fetchers/task/update-task-status", () => ({ default: api.status }));
vi.mock("@/fetchers/cycle/set-task-cycle", () => ({ default: api.cycle }));
vi.mock("@/fetchers/module/set-task-modules", () => ({ default: api.modules }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock(
  "@/hooks/mutations/task-query/use-move-task-to-group",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/hooks/mutations/task-query/use-move-task-to-group")
    >()),
    useMoveTaskToGroup: () => ({ mutateAsync: vi.fn() }),
  }),
);

vi.mock(
  "@/components/kanban-board/task-card-context-menu/task-card-context-menu-content",
  () => ({ default: () => null }),
);
vi.mock("./delete-task-dialog", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const task = { id: "t1", projectId: "p1", priority: "low" } as Task;

describe("board drops", () => {
  it("updates the priority on a drop into another priority group", async () => {
    await runGroupMove({
      task,
      action: { kind: "priority", priority: "high" },
    });
    expect(api.priority).toHaveBeenCalledWith("t1", {
      ...task,
      priority: "high",
    });
  });

  it("moves an assignee: removes the source user, then adds the target", async () => {
    await runGroupMove({
      task,
      action: { kind: "assignee", remove: "u1", add: "u2" },
    });
    expect(api.bulk.mock.calls.map(([request]) => request)).toEqual([
      { taskIds: ["t1"], operation: "removeAssignee", value: "u1" },
      { taskIds: ["t1"], operation: "addAssignee", value: "u2" },
    ]);
  });

  it("clears the assignees on a drop into No assignee", async () => {
    await runGroupMove({
      task,
      action: { kind: "assignee", remove: "u1", add: null },
    });
    expect(api.bulk).toHaveBeenCalledWith({
      taskIds: ["t1"],
      operation: "updateAssignee",
      value: null,
    });
  });
});

function boardData(groupBy: "project" | "priority"): MergedTaskQueryResult {
  return {
    mode: "rows",
    groupBy,
    subGroupBy: null,
    today: "2026-09-26",
    totalCount: 1,
    groups: [
      {
        key: groupBy === "project" ? "p1" : "low",
        count: 1,
        taskIds: ["t1"],
        nextCursor: null,
      },
    ],
    hasMoreGroups: false,
    tasks: {
      t1: {
        id: "t1",
        projectId: "p1",
        number: 1,
        key: "WEB-1",
        title: "Card",
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
      },
    },
    meta: {
      users: [],
      projects: [],
      columns: [],
      labels: [],
      cycles: [],
      modules: [],
      estimatePoints: [],
      customFields: [],
    },
  };
}

function renderBoard(groupBy: "project" | "priority") {
  render(
    <GroupedBoard
      query={
        {
          loadMore: vi.fn(),
          isLoadingMore: () => false,
        } as unknown as TaskQueryHandle
      }
      data={boardData(groupBy)}
      properties={{ ...DEFAULT_DISPLAY_PROPERTIES, customFields: [] }}
      workspaceId="w1"
      singleProject={false}
      canUpdate
      canAssign
    />,
  );
  const card = screen.getByText("Card").closest("[aria-roledescription]");
  if (!card) throw new Error("no draggable card");
  return card;
}

vi.mock("@/components/task-draft/quick-add", () => ({
  default: ({
    projectId,
    prefill,
  }: {
    projectId: string;
    prefill: { status: string; targetName: string; priority?: string };
  }) => (
    <div data-testid="quick-add">
      {`${projectId}:${prefill.status}:${prefill.priority ?? ""}:${prefill.targetName}`}
    </div>
  ),
}));

const CAN_ALL = { updateCycles: true, updateModules: true, updateTasks: true };

function renderQuickAddBoard(
  groupBy: "project" | "priority",
  scopeProjectId: string | null,
) {
  const data = boardData(groupBy);
  data.meta.columns = [
    {
      projectId: "p1",
      slug: "to-do",
      name: "To do",
      icon: null,
      group: "unstarted",
      position: 0,
      isFinal: false,
    },
  ];
  render(
    <GroupedBoard
      query={
        {
          loadMore: vi.fn(),
          isLoadingMore: () => false,
        } as unknown as TaskQueryHandle
      }
      data={data}
      properties={{ ...DEFAULT_DISPLAY_PROPERTIES, customFields: [] }}
      workspaceId="w1"
      singleProject={scopeProjectId !== null}
      canUpdate
      canAssign
      quickAdd={{ scopeProjectId, can: CAN_ALL }}
    />,
  );
}

describe("GroupedBoard", () => {
  it("lets cards move between priority groups", () => {
    expect(renderBoard("priority")).toHaveAttribute("aria-disabled", "false");
  });

  it("offers a quick add per column that takes the group's value", () => {
    renderQuickAddBoard("priority", "p1");
    expect(screen.getByTestId("quick-add").textContent).toMatch(
      /^p1:to-do:low:/,
    );
  });

  it("on cross-project boards offers it only in project groups", () => {
    renderQuickAddBoard("priority", null);
    expect(screen.queryByTestId("quick-add")).toBe(null);
    cleanup();
    renderQuickAddBoard("project", null);
    expect(screen.getByTestId("quick-add").textContent).toMatch(/^p1:to-do::/);
  });

  it("renders no quick add without the context", () => {
    renderBoard("priority");
    expect(screen.queryByTestId("quick-add")).toBe(null);
  });

  it("does not drag when grouped by project", () => {
    expect(renderBoard("project")).toHaveAttribute("aria-disabled", "true");
  });
});
