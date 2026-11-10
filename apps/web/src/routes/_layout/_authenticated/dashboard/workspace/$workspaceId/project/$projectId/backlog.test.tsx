import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./backlog";

const state = vi.hoisted(() => ({
  project: null as Record<string, unknown> | null,
  setProject: vi.fn(),
  updateTaskStatus: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; column?: string }) =>
      options?.count !== undefined
        ? `${key}(${options.count}${options.column ? `,${options.column}` : ""})`
        : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => ({ workspaceId: "w", projectId: "p" }),
    useSearch: () => ({ taskId: undefined }),
  }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({ data: undefined }),
}));
vi.mock("@/hooks/mutations/task/use-update-task-status", () => ({
  useUpdateTaskStatus: () => ({ mutate: state.updateTaskStatus }),
}));
vi.mock("@/store/project", () => ({
  default: () => ({ project: state.project, setProject: state.setProject }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => ({ setViewMode: vi.fn() }),
}));
vi.mock("@/hooks/use-task-query-state", () => ({
  useTaskQueryState: () => ({ display: {}, state: {} }),
}));
vi.mock("@/lib/task-query/display", () => ({
  toSortConfig: () => ({ field: "position" }),
}));
vi.mock("@/hooks/queries/estimate/use-estimate-sort", () => ({
  useEstimateSort: () => ({ sort: { field: "position" }, context: {} }),
}));
vi.mock("@/hooks/use-classic-board-filter", () => ({
  useClassicBoardFilter: ({ project }: { project: unknown }) => ({
    filteredProject: project,
    status: {},
    isPendingFilter: false,
  }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => {},
}));
vi.mock("@/components/task-filters/use-display-config", () => ({
  useDisplayConfig: () => ({}),
}));
vi.mock("@/components/task-filters/task-toolbar", () => ({
  default: ({ leftSlot }: { leftSlot: ReactNode }) => <div>{leftSlot}</div>,
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/backlog-list-view", () => ({ default: () => null }));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: () => null,
}));
vi.mock("@/lib/toast", () => ({ toast: state.toast }));

const BacklogRoute = (Route as unknown as { component: ComponentType })
  .component;

const planned = [
  { id: "a", title: "A", status: "planned" },
  { id: "b", title: "B", status: "planned" },
];

beforeEach(() => {
  state.project = {
    id: "p",
    name: "Project",
    columns: [
      {
        id: "to-do",
        slug: "to-do",
        name: "To Do",
        position: 0,
        group: "unstarted",
        tasks: [],
      },
    ],
    plannedTasks: planned,
    archivedTasks: [],
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Backlog move all", () => {
  it("moves the planned tasks only after the in-app confirmation", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<BacklogRoute />);
    fireEvent.click(
      screen.getByRole("button", { name: /tasks:backlog.moveAll/ }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "tasks:backlog.moveAllConfirmTitle(2,To Do)",
    );
    expect(state.updateTaskStatus).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:backlog.moveAllConfirmAction",
      }),
    );

    expect(state.updateTaskStatus).toHaveBeenCalledTimes(2);
    expect(state.updateTaskStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", status: "to-do" }),
    );
    expect(state.toast.success).toHaveBeenCalledWith(
      "tasks:backlog.moveAllSuccess(2,To Do)",
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("moves nothing when cancelled", async () => {
    render(<BacklogRoute />);
    fireEvent.click(
      screen.getByRole("button", { name: /tasks:backlog.moveAll/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "common:actions.cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(state.updateTaskStatus).not.toHaveBeenCalled();
    expect(state.setProject).not.toHaveBeenCalled();
  });

  it("says there is nothing to move without asking", () => {
    state.project = { ...(state.project ?? {}), plannedTasks: [] };
    render(<BacklogRoute />);
    fireEvent.click(
      screen.getByRole("button", { name: /tasks:backlog.moveAll/ }),
    );

    expect(state.toast.info).toHaveBeenCalledWith(
      "tasks:backlog.noTasksToMove",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
