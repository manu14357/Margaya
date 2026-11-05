import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./board";

const state = vi.hoisted(() => ({
  viewMode: "board" as "board" | "list",
  storeProject: null as { id: string; name: string } | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => ({ workspaceId: "w", projectId: "p" }),
    useSearch: () => ({ taskId: undefined }),
  }),
  useNavigate: () => vi.fn(),
}));

const useGetTasks = vi.fn();
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => useGetTasks(),
}));
vi.mock("@/store/project", () => ({
  default: () => ({ project: state.storeProject, setProject: vi.fn() }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => ({
    viewMode: state.viewMode,
    setViewMode: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-task-query-state", () => ({
  useTaskQueryState: () => ({
    display: {},
    archived: "exclude",
    state: {},
    hasActiveFilters: false,
  }),
}));
vi.mock("@/lib/task-query/display", () => ({
  isClassicDisplay: () => true,
  toSortConfig: () => ({ field: "position" }),
}));
vi.mock("@/hooks/queries/estimate/use-estimate-sort", () => ({
  useEstimateSort: () => ({ sort: { field: "position" }, context: {} }),
}));
vi.mock("@/hooks/queries/task/use-description-matches", () => ({
  useDescriptionMatches: () => ({ ids: undefined }),
}));
vi.mock("@/hooks/queries/task-query/use-task-query-rows", () => ({
  useTaskQueryRows: () => ({}),
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
vi.mock("@/hooks/use-project-features", () => ({
  useProjectFeatures: () => ({ isEnabled: () => false }),
}));

vi.mock("@/components/common/project-layout", () => ({
  default: ({
    children,
    activeView,
  }: {
    children: ReactNode;
    activeView: string;
  }) => (
    <div data-testid="layout" data-active={activeView}>
      {children}
    </div>
  ),
}));
vi.mock("@/components/board/board-toolbar", () => ({
  default: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
}));
vi.mock("@/components/kanban-board", () => ({
  default: () => <div data-testid="kanban" />,
}));
vi.mock("@/components/list-view", () => ({
  default: () => <div data-testid="list" />,
}));
vi.mock("@/components/ai-build/build-with-ai-empty-hint", () => ({
  default: () => null,
}));
vi.mock("@/components/bulk-selection/bulk-toolbar", () => ({
  default: () => null,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: () => null,
}));
vi.mock("@/components/task-layouts/task-query-view", () => ({
  default: () => null,
}));
vi.mock("@/components/view/save-view-actions", () => ({ default: () => null }));

const BoardRoute = (Route as unknown as { component: ComponentType }).component;

const TRY_AGAIN = "common:states.error.tryAgain";
const SEARCH = "tasks:boardSearchOpen";

function failedQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    error: new Error("boom"),
    errorUpdatedAt: 1,
    refetch: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

beforeEach(() => {
  state.viewMode = "board";
  state.storeProject = null;
  useGetTasks.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
    errorUpdatedAt: 0,
    refetch: vi.fn(),
  });
});
afterEach(cleanup);

describe("board load states", () => {
  it("shows the skeleton, not an error, during the first load", () => {
    render(<BoardRoute />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: TRY_AGAIN })).toBeNull();
  });

  it("shows an error with a retry when the tasks fail to load", () => {
    const query = failedQuery();
    useGetTasks.mockReturnValue(query);
    render(<BoardRoute />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: TRY_AGAIN }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the error up while a background poll tries again", () => {
    useGetTasks.mockReturnValue(failedQuery({ isLoading: true, error: null }));
    render(<BoardRoute />);
    expect(screen.getByRole("button", { name: TRY_AGAIN })).toBeInTheDocument();
  });

  it("keeps showing loaded tasks when a later refresh fails", () => {
    state.storeProject = { id: "p", name: "Project" };
    useGetTasks.mockReturnValue(
      failedQuery({ data: { id: "p", name: "Project" } }),
    );
    render(<BoardRoute />);

    expect(screen.getByTestId("kanban")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("board layout tab", () => {
  it.each([
    ["board", "kanban"],
    ["list", "list"],
  ] as const)("selects the %s tab while drawing the %s", (mode, testId) => {
    state.viewMode = mode;
    state.storeProject = { id: "p", name: "Project" };
    useGetTasks.mockReturnValue({
      data: { id: "p", name: "Project" },
      isLoading: false,
      error: null,
      errorUpdatedAt: 0,
      refetch: vi.fn(),
    });
    render(<BoardRoute />);

    expect(screen.getByTestId("layout")).toHaveAttribute("data-active", mode);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});

describe("board search", () => {
  const field = () =>
    screen.getByPlaceholderText("tasks:boardSearchPlaceholder");

  it("has a visible control that opens and focuses the field", () => {
    render(<BoardRoute />);
    fireEvent.click(screen.getByRole("button", { name: SEARCH }));
    expect(field()).toHaveFocus();
    expect(screen.queryByRole("button", { name: SEARCH })).toBeNull();
  });

  it("still opens with Ctrl+F", () => {
    render(<BoardRoute />);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(field()).toHaveFocus();
  });

  it("closes when empty and stays open while it holds a search", () => {
    render(<BoardRoute />);
    fireEvent.click(screen.getByRole("button", { name: SEARCH }));

    fireEvent.change(field(), { target: { value: "login" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    fireEvent.blur(field());
    expect(field()).toHaveValue("login");

    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.getByRole("button", { name: SEARCH })).toBeInTheDocument();
  });
});
