import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import PageTrashView from "./page-trash-view";
import ProjectTrashView from "./project-trash-view";
import TaskTrashView from "./task-trash-view";

type Item = Record<string, unknown>;

const m = vi.hoisted(() => ({
  tasks: [] as Item[],
  projects: [] as Item[],
  pages: [] as Item[],
  taskQueryState: { isPending: false, isError: false },
  restorePage: vi.fn(),
  purgePage: vi.fn(),
  restoreTask: vi.fn(),
  purgeTask: vi.fn(),
  emptyTrash: vi.fn(),
  restoreProject: vi.fn(),
  purgeProject: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/queries/trash/use-task-trash", () => ({
  useTaskTrash: () => ({
    ...m.taskQueryState,
    data: { pages: [{ items: m.tasks }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: m.refetch,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/trash/use-project-trash", () => ({
  useProjectTrash: () => ({
    isPending: false,
    isError: false,
    data: { pages: [{ items: m.projects }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/trash/use-page-trash", () => ({
  usePageTrash: () => ({
    isPending: false,
    isError: false,
    data: { pages: [{ items: m.pages }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("@/hooks/mutations/trash/use-trash-mutations", () => ({
  useRestoreTask: () => ({ mutateAsync: m.restoreTask }),
  usePurgeTask: () => ({ mutateAsync: m.purgeTask, isPending: false }),
  useEmptyTaskTrash: () => ({ mutateAsync: m.emptyTrash, isPending: false }),
  useRestoreProject: () => ({ mutateAsync: m.restoreProject }),
  usePurgeProject: () => ({ mutateAsync: m.purgeProject, isPending: false }),
  useRestoreDeletedPage: () => ({ mutateAsync: m.restorePage }),
  usePurgePage: () => ({ mutateAsync: m.purgePage, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

function task(overrides: Item = {}): Item {
  return {
    id: "t1",
    projectId: "p1",
    number: 12,
    key: "web-12",
    title: "Fix the login form",
    status: "to-do",
    priority: "low",
    subTaskCount: 2,
    deletedAt: "2026-10-10T08:00:00.000Z",
    deletedBy: { id: "u1", name: "Ada" },
    purgeAt: "2026-11-09T08:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  m.tasks = [];
  m.projects = [];
  m.pages = [];
  m.taskQueryState = { isPending: false, isError: false };
  for (const fn of [
    m.restorePage,
    m.purgePage,
    m.restoreTask,
    m.purgeTask,
    m.emptyTrash,
    m.restoreProject,
    m.purgeProject,
    m.refetch,
    m.success,
    m.error,
  ]) {
    fn.mockReset();
  }
});
afterEach(cleanup);

describe("TaskTrashView", () => {
  it("lists deleted tasks with who deleted them and their sub-tasks", () => {
    m.tasks = [task()];
    render(<TaskTrashView projectId="p1" canDelete />);

    expect(screen.getByText("WEB-12")).toBeTruthy();
    expect(screen.getByText("Fix the login form")).toBeTruthy();
    expect(
      screen.getByText(/settings:trash.withSubTasks \{"count":2\}/),
    ).toBeTruthy();
    expect(
      screen.getByText(/settings:trash.deletedBy.*"name":"Ada"/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /settings:trash.emptyTrash/ }),
    ).toBeTruthy();
  });

  it("restores a task and reports success", async () => {
    m.tasks = [task()];
    m.restoreTask.mockResolvedValue({ id: "t1" });
    render(<TaskTrashView projectId="p1" canDelete />);

    fireEvent.click(
      screen.getByRole("button", { name: /settings:trash.restoreAria/ }),
    );
    await waitFor(() => expect(m.restoreTask).toHaveBeenCalledWith("t1"));
    expect(m.success).toHaveBeenCalledWith("settings:trash.toast.taskRestored");
  });

  it("explains a blocked restore", async () => {
    m.tasks = [task()];
    m.restoreTask.mockRejectedValue(new HttpError(409, "blocked"));
    render(<TaskTrashView projectId="p1" canDelete />);

    fireEvent.click(
      screen.getByRole("button", { name: /settings:trash.restoreAria/ }),
    );
    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith(
        "settings:trash.toast.restoreBlocked",
      ),
    );
  });

  it("empties the trash only after confirming", async () => {
    m.tasks = [task()];
    m.emptyTrash.mockResolvedValue({ deletedCount: 3 });
    render(<TaskTrashView projectId="p1" canDelete />);

    fireEvent.click(
      screen.getByRole("button", { name: "settings:trash.emptyTrash" }),
    );
    expect(m.emptyTrash).not.toHaveBeenCalled();
    expect(
      await screen.findByText("settings:trash.emptyConfirmDescription"),
    ).toBeTruthy();
    const confirm = screen
      .getAllByRole("button", { name: "settings:trash.emptyTrash" })
      .at(-1);
    if (!confirm) throw new Error("missing confirm button");
    fireEvent.click(confirm);
    await waitFor(() => expect(m.emptyTrash).toHaveBeenCalled());
    expect(m.success).toHaveBeenCalledWith(
      'settings:trash.toast.emptied {"count":3}',
    );
  });

  it("deletes a task permanently only after confirming", async () => {
    m.tasks = [task()];
    m.purgeTask.mockResolvedValue({ id: "t1" });
    render(<TaskTrashView projectId="p1" canDelete />);

    fireEvent.click(
      screen.getByRole("button", { name: /settings:trash.menuAria/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "settings:trash.deletePermanently",
      }),
    );
    expect(m.purgeTask).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/settings:trash.purgeTaskDescription/),
    ).toBeTruthy();
    const confirm = screen
      .getAllByRole("button", { name: "settings:trash.deletePermanently" })
      .at(-1);
    if (!confirm) throw new Error("missing confirm button");
    fireEvent.click(confirm);
    await waitFor(() => expect(m.purgeTask).toHaveBeenCalledWith("t1"));
    expect(m.success).toHaveBeenCalledWith("settings:trash.toast.taskPurged");
  });

  it("hides the actions without task:delete", () => {
    m.tasks = [task()];
    render(<TaskTrashView projectId="p1" canDelete={false} />);

    expect(screen.getByText("Fix the login form")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /settings:trash.restoreAria/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /settings:trash.emptyTrash/ }),
    ).toBeNull();
  });

  it("shows the empty, loading and error states", () => {
    const { rerender } = render(<TaskTrashView projectId="p1" canDelete />);
    expect(screen.getByText("settings:trash.emptyTasksTitle")).toBeTruthy();

    m.taskQueryState = { isPending: false, isError: true };
    rerender(<TaskTrashView projectId="p1" canDelete />);
    expect(screen.getByText("settings:trash.loadError")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "settings:trash.retry" }),
    );
    expect(m.refetch).toHaveBeenCalled();
  });
});

describe("PageTrashView", () => {
  function deletedPage(overrides: Item = {}): Item {
    return {
      id: "pg1",
      projectId: "p1",
      title: "Runbook",
      logoKind: null,
      logoValue: null,
      access: "public",
      canManage: true,
      deletedAt: "2026-10-10T08:00:00.000Z",
      deletedBy: { id: "u1", name: "Ada" },
      purgeAt: "2026-11-09T08:00:00.000Z",
      ...overrides,
    };
  }

  it("lists a deleted page and restores it", async () => {
    m.pages = [deletedPage()];
    m.restorePage.mockResolvedValue({ id: "pg1" });
    render(<PageTrashView projectId="p1" />);

    expect(screen.getByText("Runbook")).toBeTruthy();
    expect(
      screen.getByText(/settings:trash.deletedBy.*"name":"Ada"/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /settings:trash.restoreAria/ }),
    );
    await waitFor(() => expect(m.restorePage).toHaveBeenCalledWith("pg1"));
    expect(m.success).toHaveBeenCalledWith("settings:trash.toast.pageRestored");
  });

  it("names an untitled page and shows the API's reason for a failure", async () => {
    m.pages = [deletedPage({ title: "   " })];
    m.restorePage.mockRejectedValue(
      new HttpError(409, "This project has reached the limit of 5,000 pages"),
    );
    render(<PageTrashView projectId="p1" />);

    expect(screen.getByText("pages:list.untitled")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /settings:trash.restoreAria/ }),
    );
    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith(
        "This project has reached the limit of 5,000 pages",
      ),
    );
  });

  it("deletes a page permanently only after confirming", async () => {
    m.pages = [deletedPage()];
    m.purgePage.mockResolvedValue({ id: "pg1" });
    render(<PageTrashView projectId="p1" />);

    fireEvent.click(
      screen.getByRole("button", { name: /settings:trash.menuAria/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "settings:trash.deletePermanently",
      }),
    );
    expect(m.purgePage).not.toHaveBeenCalled();
    const confirm = screen
      .getAllByRole("button", { name: "settings:trash.deletePermanently" })
      .at(-1);
    if (!confirm) throw new Error("missing confirm button");
    fireEvent.click(confirm);
    await waitFor(() => expect(m.purgePage).toHaveBeenCalledWith("pg1"));
    expect(m.success).toHaveBeenCalledWith("settings:trash.toast.pagePurged");
  });

  it("hides the actions on a page the caller may not manage", () => {
    m.pages = [deletedPage({ canManage: false })];
    render(<PageTrashView projectId="p1" />);

    expect(screen.getByText("Runbook")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /settings:trash.restoreAria/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /settings:trash.menuAria/ }),
    ).toBeNull();
  });
});

describe("ProjectTrashView", () => {
  it("lists deleted projects and restores one", async () => {
    m.projects = [
      {
        id: "p9",
        name: "Old site",
        slug: "old",
        icon: null,
        taskCount: 4,
        deletedAt: "2026-10-10T08:00:00.000Z",
        deletedBy: null,
        purgeAt: null,
      },
    ];
    m.restoreProject.mockResolvedValue({ id: "p9" });
    render(<ProjectTrashView workspaceId="w1" canDelete />);

    expect(screen.getByText("OLD")).toBeTruthy();
    expect(screen.getByText("Old site")).toBeTruthy();
    expect(
      screen.getByText(/settings:trash.taskCount \{"count":4\}/),
    ).toBeTruthy();
    expect(screen.getByText(/settings:trash.deletedAt/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /settings:trash.restoreAria/ }),
    );
    await waitFor(() => expect(m.restoreProject).toHaveBeenCalledWith("p9"));
    expect(m.success).toHaveBeenCalledWith(
      "settings:trash.toast.projectRestored",
    );
  });
});
