import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import DraftsPage from "./drafts-page";

type Row = Record<string, unknown>;

const m = vi.hoisted(() => ({
  canCreate: true,
  drafts: {
    isPending: false,
    isError: false,
    rows: [] as Row[],
    hasNextPage: false,
  },
  publish: vi.fn(),
  deleteDraft: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => m.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && ("key" in options || "list" in options)
        ? `${key}|${options.key ?? ""}|${options.list ?? ""}`
        : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/components/common/workspace-layout", () => ({
  default: ({
    headerActions,
    children,
  }: {
    headerActions?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      {headerActions}
      {children}
    </div>
  ),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: ({
    open,
    primaryAction,
  }: {
    open: boolean;
    primaryAction?: string;
  }) => (open ? <div data-testid="create-modal">{primaryAction}</div> : null),
}));
vi.mock("./draft-editor", () => ({
  default: ({ draftId }: { draftId: string | null }) =>
    draftId ? <div data-testid="draft-editor">{draftId}</div> : null,
}));
vi.mock("@/hooks/queries/task-draft/use-task-drafts", () => ({
  useTaskDrafts: () => ({
    isPending: m.drafts.isPending,
    isError: m.drafts.isError,
    data: m.drafts.isPending
      ? undefined
      : { pages: [{ drafts: m.drafts.rows }] },
    hasNextPage: m.drafts.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "p1", name: "Web" }] }),
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useAssigneePeople: () => ({ people: [] }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateTasks: () => m.canCreate,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/mutations/task-draft/use-publish-task-draft", () => ({
  usePublishTaskDraft: () => ({ mutateAsync: m.publish }),
}));
vi.mock("@/hooks/mutations/task-draft/use-delete-task-draft", () => ({
  useDeleteTaskDraft: () => ({ mutateAsync: m.deleteDraft }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, warning: m.warning, error: m.error },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function draftRow(overrides: Row = {}): Row {
  return {
    id: "d1",
    workspaceId: "w1",
    projectId: null,
    project: null,
    title: "",
    status: null,
    priority: "no-priority",
    assigneeIds: [],
    labels: [],
    startDate: null,
    dueDate: null,
    customFieldValues: [],
    cycleId: null,
    moduleIds: [],
    estimatePointId: null,
    parentTaskId: null,
    parentTask: null,
    hasDescription: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function openRowMenu() {
  fireEvent.click(
    screen.getByRole("button", { name: "tasks:drafts.actions.menuAria" }),
  );
}

beforeEach(() => {
  m.canCreate = true;
  m.drafts = { isPending: false, isError: false, rows: [], hasNextPage: false };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DraftsPage", () => {
  it("shows skeleton rows while loading", () => {
    m.drafts.isPending = true;
    const { container } = render(<DraftsPage workspaceId="w1" />, {
      wrapper,
    });
    expect(container.querySelectorAll(".h-12")).toHaveLength(6);
  });

  it("shows the empty state with New task for people who can create", () => {
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    expect(screen.getByText("tasks:drafts.empty.title")).toBeTruthy();
    fireEvent.click(screen.getByText("tasks:drafts.empty.newTask"));
    expect(screen.getByTestId("create-modal").textContent).toBe("create");
  });

  it("hides New task and New draft without task:create", () => {
    m.canCreate = false;
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    expect(screen.queryByText("tasks:drafts.empty.newTask")).toBeNull();
    expect(screen.queryByText("tasks:drafts.newDraft")).toBeNull();
  });

  it("opens New draft with Save as draft as the primary action", () => {
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    fireEvent.click(screen.getByText("tasks:drafts.newDraft"));
    expect(screen.getByTestId("create-modal").textContent).toBe("draft");
  });

  it("says when a search matches nothing", () => {
    render(<DraftsPage workspaceId="w1" q="nothing" />, { wrapper });
    expect(screen.getByText("tasks:drafts.noResults")).toBeTruthy();
    expect(screen.getByText("tasks:drafts.clearFilters")).toBeTruthy();
  });

  it("names untitled drafts and drafts without a project", () => {
    m.drafts.rows = [draftRow()];
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    expect(screen.getByText("tasks:drafts.untitled")).toBeTruthy();
    expect(
      screen.getAllByText("tasks:drafts.noProject").length,
    ).toBeGreaterThan(0);
  });

  it("opens the editor from a row", () => {
    m.drafts.rows = [draftRow({ title: "Fix login" })];
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    fireEvent.click(screen.getByText("Fix login"));
    expect(screen.getByTestId("draft-editor").textContent).toBe("d1");
  });

  it("toasts the new task's key after publishing", async () => {
    m.drafts.rows = [draftRow({ title: "Fix login" })];
    m.publish.mockResolvedValue({
      task: { id: "t1", projectId: "p1" },
      key: "web-12",
      dropped: [],
    });
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    openRowMenu();
    fireEvent.click(await screen.findByText("tasks:drafts.actions.publish"));
    await waitFor(() =>
      expect(m.success).toHaveBeenCalledWith(
        "tasks:drafts.toast.published|WEB-12|",
        expect.objectContaining({
          action: expect.objectContaining({ label: "tasks:drafts.toast.open" }),
        }),
      ),
    );
    expect(m.publish).toHaveBeenCalledWith({
      id: "d1",
      workspaceId: "w1",
      patch: undefined,
    });
  });

  it("warns about properties that could not be kept", async () => {
    m.drafts.rows = [draftRow({ title: "Fix login" })];
    m.publish.mockResolvedValue({
      task: { id: "t1", projectId: "p1" },
      key: "web-12",
      dropped: ["cycle", "status"],
    });
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    openRowMenu();
    fireEvent.click(await screen.findByText("tasks:drafts.actions.publish"));
    await waitFor(() =>
      expect(m.warning).toHaveBeenCalledWith(
        "tasks:drafts.toast.publishedPartial|WEB-12|tasks:drafts.dropped.cycle, tasks:drafts.dropped.status",
        expect.any(Object),
      ),
    );
  });

  it("opens the editor when the server refuses to publish", async () => {
    m.drafts.rows = [draftRow({ title: "No project" })];
    m.publish.mockRejectedValue(
      new HttpError(400, "Choose a project before publishing"),
    );
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    openRowMenu();
    fireEvent.click(await screen.findByText("tasks:drafts.actions.publish"));
    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith(
        "Choose a project before publishing",
      ),
    );
    expect(screen.getByTestId("draft-editor").textContent).toBe("d1");
  });

  it("deletes after confirming", async () => {
    m.drafts.rows = [draftRow({ title: "Old idea" })];
    m.deleteDraft.mockResolvedValue({ id: "d1" });
    render(<DraftsPage workspaceId="w1" />, { wrapper });
    openRowMenu();
    fireEvent.click(await screen.findByText("tasks:drafts.actions.delete"));
    fireEvent.click(
      await screen.findByText("tasks:drafts.deleteConfirm.confirm"),
    );
    expect(m.deleteDraft).toHaveBeenCalledWith({ id: "d1", workspaceId: "w1" });
    await waitFor(() =>
      expect(m.success).toHaveBeenCalledWith("tasks:drafts.toast.deleted"),
    );
  });
});
