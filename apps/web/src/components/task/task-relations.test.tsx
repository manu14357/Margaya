import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskRelations from "./task-relations";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  relations: [] as unknown[],
  create: vi.fn(),
  remove: vi.fn(),
  searches: [] as string[],
  searchResults: [] as unknown[],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/task-relation/use-get-task-relations", () => ({
  default: () => ({ data: mocks.relations }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      slug: "web",
      columns: [
        {
          id: "to-do",
          position: 0,
          isFinal: false,
          group: "unstarted",
          icon: null,
          tasks: [
            { id: "t-open", number: 7, title: "Open work", status: "to-do" },
          ],
        },
      ],
      plannedTasks: [],
    },
  }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { id: "p-web", slug: "web" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useAssigneePeople: () => ({ people: [] }),
}));
vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: ({ q }: { q: string }) => {
    mocks.searches.push(q);
    return {
      data: q ? { results: mocks.searchResults } : undefined,
      isFetching: false,
      isError: false,
    };
  },
}));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: mocks.create }),
}));
vi.mock("@/hooks/mutations/task-relation/use-delete-task-relation", () => ({
  default: () => ({ mutate: mocks.remove }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("./subtask-status-popover", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./subtask-assignee-popover", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function summary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    status: "to-do",
    priority: "no-priority",
    number: Number(id.replace(/\D/g, "")) || 1,
    projectId: "p-web",
    projectSlug: "web",
    projectName: "Web",
    group: "unstarted",
    userId: null,
    assigneeName: null,
    assigneeIds: [],
    ...overrides,
  };
}

function relation(
  id: string,
  source: ReturnType<typeof summary>,
  target: ReturnType<typeof summary>,
  relationType: string,
) {
  return {
    id,
    sourceTaskId: source.id,
    targetTaskId: target.id,
    relationType,
    createdAt: "2026-09-01T00:00:00.000Z",
    sourceTask: source,
    targetTask: target,
  };
}

const me = summary("t1");

function renderRelations() {
  return render(
    <TaskRelations taskId="t1" projectId="p-web" workspaceId="ws-1" />,
  );
}

beforeEach(() => {
  mocks.relations = [];
  mocks.searches = [];
  mocks.searchResults = [];
  mocks.create.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskRelations", () => {
  it("groups relations as this task reads them, in the fixed order", () => {
    mocks.relations = [
      relation("r1", me, summary("t2"), "related"),
      relation("r2", summary("t3"), me, "blocks"),
      relation("r3", me, summary("t4"), "blocks"),
      relation("r4", summary("t5"), me, "start_before"),
      relation("r5", me, summary("t6"), "subtask"),
    ];
    const { container } = renderRelations();

    const groups = [...container.querySelectorAll("[data-relation-group]")].map(
      (group) => group.getAttribute("data-relation-group"),
    );
    expect(groups).toEqual([
      "blocked_by",
      "blocking",
      "related",
      "start_after",
    ]);
    expect(screen.getByText("Task t3")).toBeInTheDocument();
    // The key of each related task comes first, in upper case.
    expect(screen.getByText("WEB-3")).toBeInTheDocument();
    // Sub-tasks are listed in their own section.
    expect(screen.queryByText("Task t6")).toBeNull();
  });

  it("opens a related task in its own project", () => {
    mocks.relations = [
      relation(
        "r1",
        me,
        summary("t9", {
          projectId: "p-ops",
          projectSlug: "ops",
          projectName: "Ops",
          group: "completed",
        }),
        "related",
      ),
    ];
    renderRelations();

    expect(screen.getByText("OPS-9")).toHaveAttribute("title", "Ops");
    expect(screen.getByText("Task t9")).toHaveClass("line-through");
    fireEvent.click(screen.getByText("Task t9"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId: "ws-1", projectId: "p-ops", taskId: "t9" },
    });
  });

  it("links a picked task with the chosen relation's input name", async () => {
    renderRelations();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:detailActions.addRelation" }),
    );

    const typeSelect = await screen.findByRole("combobox", {
      name: "tasks:relations.relationLabel",
    });
    expect(typeSelect).toHaveTextContent("tasks:relations.groups.related");
    fireEvent.click(typeSelect);
    const blockedBy = await screen.findByRole("option", {
      name: "tasks:relations.groups.blocked_by",
    });
    // A mouse selection starts with a press on the option.
    fireEvent.pointerDown(blockedBy, { pointerType: "mouse" });
    fireEvent.click(blockedBy);
    await waitFor(() =>
      expect(typeSelect).toHaveTextContent("tasks:relations.groups.blocked_by"),
    );
    fireEvent.click(await screen.findByText("Open work"));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        sourceTaskId: "t1",
        targetTaskId: "t-open",
        relationType: "blocked_by",
      }),
    );
  });

  it("searches other projects once the query has two characters", async () => {
    mocks.searchResults = [
      {
        id: "t-other",
        type: "task",
        title: "Deploy pipeline",
        projectId: "p-ops",
        projectName: "Ops",
        projectSlug: "ops",
        taskNumber: 4,
        status: "to-do",
      },
      {
        id: "t-open",
        type: "task",
        title: "Open work",
        projectId: "p-web",
        projectSlug: "web",
        taskNumber: 7,
        status: "to-do",
      },
    ];
    renderRelations();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:detailActions.addRelation" }),
    );
    const input = await screen.findByPlaceholderText(
      "tasks:relations.searchPlaceholder",
    );

    fireEvent.change(input, { target: { value: "d" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByText("tasks:relations.otherProjects")).toBeNull();
    expect(mocks.searches.every((q) => q === "")).toBe(true);

    fireEvent.change(input, { target: { value: "de" } });
    expect(
      await screen.findByText("tasks:relations.otherProjects"),
    ).toBeInTheDocument();
    expect(screen.getByText("Deploy pipeline")).toBeInTheDocument();
    expect(screen.getByText("OPS-4")).toBeInTheDocument();
    expect(mocks.searches).toContain("de");
  });
});
