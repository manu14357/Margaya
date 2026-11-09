import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CreateTaskModal from "./create-task-modal";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const useLocation = vi.fn();
const deleteTask = vi.fn(async () => {});
const updateTask = vi.fn(async (input: Record<string, unknown>) => input);
const setProject = vi.fn();
let workspaceId = "workspace-1";
let projects: { id: string; name: string; slug: string }[] | undefined;
let storedProject: { id: string; columns: unknown[] } | null = null;
let ensureTaskId: (() => Promise<string | null>) | undefined;
let members: Array<{
  userId: string;
  user: { name: string; image: string | null };
}> = [];

beforeEach(() => {
  canUpdateTasks = true;
  workspaceId = "workspace-1";
  projects = [
    { id: "project-1", name: "Alpha", slug: "alp" },
    { id: "project-2", name: "Beta", slug: "bet" },
  ];
  storedProject = null;
  similarTasks = [];
  columns = undefined;
  members = [];
  useLocation.mockReturnValue({ pathname: "/dashboard/workspace/workspace-1" });
});
const createTask = vi.fn(async (input: Record<string, unknown>) => ({
  id: "task-1",
  title: input.title,
  status: input.status,
  projectId: input.projectId,
  createdAt: "2026-08-05T00:00:00.000Z",
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const navigate = vi.fn();
const createDraft = vi.fn(async (input: Record<string, unknown>) => input);
const updateDraft = vi.fn(async (input: Record<string, unknown>) => input);
const publishDraft = vi.fn(async (..._args: unknown[]) => "published");

vi.mock("@/hooks/mutations/task-draft/use-create-task-draft", () => ({
  useCreateTaskDraft: () => ({ mutateAsync: createDraft }),
}));

vi.mock("@/hooks/mutations/task-draft/use-update-task-draft", () => ({
  useUpdateTaskDraft: () => ({ mutateAsync: updateDraft }),
}));

vi.mock("@/components/task-draft/use-publish-draft-flow", () => ({
  usePublishDraftFlow: () => publishDraft,
}));

vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: undefined }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => useLocation(),
  useParams: ({
    select,
  }: {
    select: (params: { workspaceId?: string }) => unknown;
  }) =>
    select({
      workspaceId: useLocation().pathname.match(/\/workspace\/([^/]+)/)?.[1],
    }),
}));

vi.mock("@/components/task/task-description-editor", () => ({
  default: (props: {
    taskId?: string;
    ensureTaskId: () => Promise<string | null>;
  }) => {
    ensureTaskId = props.ensureTaskId;
    return <div data-testid="description-editor" data-task-id={props.taskId} />;
  },
}));

vi.mock("@/hooks/mutations/label/use-create-label", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-create-task", () => ({
  default: () => ({ mutateAsync: createTask }),
}));

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: deleteTask }),
}));

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: updateTask }),
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: workspaceId, name: "WS" } }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members } }),
  }),
);

// In a project, the pickers offer its people; here the same people.
vi.mock("@/hooks/queries/project/use-project-audience", () => ({
  default: () => ({
    data: members.map((member) => ({
      id: member.userId,
      name: member.user.name,
      image: member.user.image,
    })),
    isLoading: false,
  }),
}));

let canUpdateTasks = true;
const setTaskParent = vi.fn(async (input: Record<string, unknown>) => input);

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateTasks: () => true,
    canCreateLabels: () => true,
    canUpdateTasks: () => canUpdateTasks,
  }),
}));

vi.mock("@/hooks/mutations/task-relation/use-set-task-parent", () => ({
  default: () => ({ mutateAsync: setTaskParent }),
}));

const createTaskRelation = vi.fn(
  async (input: Record<string, unknown>) => input,
);
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: createTaskRelation }),
}));

vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: false }),
}));

let similarTasks: { id: string; key: string; title: string }[] = [];
const useSimilarTasks = vi.fn(
  (_projectId: string | undefined, _title: string, enabled: boolean) =>
    enabled ? similarTasks : [],
);
vi.mock("@/hooks/queries/task/use-similar-tasks", () => ({
  useSimilarTasks: (
    projectId: string | undefined,
    title: string,
    enabled: boolean,
  ) => useSimilarTasks(projectId, title, enabled),
}));

vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: (projectId: string) => ({
    isLoading: false,
    data: projectId
      ? {
          slug: "alp",
          columns: [
            {
              id: "ready",
              position: 0,
              group: "unstarted",
              tasks: [
                { id: "parent-1", number: 7, title: "Epic", status: "ready" },
              ],
            },
          ],
          plannedTasks: [],
        }
      : undefined,
  }),
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: projects }),
}));

let columns:
  | { slug: string; name: string; position: number; group: string }[]
  | undefined;

vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({ data: columns }),
}));

vi.mock("@/store/project", () => ({
  default: () => ({ project: storedProject, setProject }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

describe("CreateTaskModal", () => {
  it("keeps unsaved input while discard confirmation is open", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    const onClose = vi.fn();

    render(<CreateTaskModal open onClose={onClose} />, {
      wrapper: createWrapper(),
    });

    const titleInput = screen.getByPlaceholderText(
      "common:modals.createTask.taskTitlePlaceholder",
    );
    fireEvent.change(titleInput, { target: { value: "Unsaved task" } });

    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
    expect(titleInput).toHaveValue("Unsaved task");

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    expect(createTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after the user confirms discarding unsaved input", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    const onClose = vi.fn();

    render(<CreateTaskModal open onClose={onClose} />, {
      wrapper: createWrapper(),
    });

    fireEvent.change(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
      { target: { value: "Unsaved task" } },
    );
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    await screen.findByText("common:modals.createTask.discardTitle");

    fireEvent.click(screen.getByText("common:modals.createTask.discardButton"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("treats a selected project as unsaved input", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.selectProject"));
    fireEvent.click(await screen.findByText("Beta"));
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
  });

  it("shows a project picker and creates the task in the chosen project", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    const pickerTrigger = screen.getByText(
      "common:modals.createTask.selectProject",
    );
    fireEvent.click(pickerTrigger);
    fireEvent.click(await screen.findByText("Beta"));

    fireEvent.change(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
      { target: { value: "Picked project task" } },
    );
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Picked project task",
          projectId: "project-2",
        }),
      );
    });
  });

  it("creates the task in the project's entry column", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    columns = [
      { slug: "doing", name: "Doing", position: 0, group: "started" },
      { slug: "ready", name: "Ready", position: 1, group: "unstarted" },
    ];

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByText("Ready")).toBeInTheDocument();
    enterTitle("Entry column task");
    submit();

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ready", projectId: "project-1" }),
      );
    });
  });

  it("hides the picker when a project is in scope from the route", () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    expect(
      screen.queryByText("common:modals.createTask.selectProject"),
    ).toBeNull();
  });
});

function enterTitle(title = "Private task") {
  fireEvent.change(
    screen.getByPlaceholderText(
      "common:modals.createTask.taskTitlePlaceholder",
    ),
    {
      target: { value: title },
    },
  );
}

async function chooseBeta() {
  fireEvent.click(screen.getByText("common:modals.createTask.selectProject"));
  fireEvent.click(await screen.findByText("Beta"));
}

function submit() {
  fireEvent.submit(document.querySelector("form") as HTMLFormElement);
}

function pendingCreate() {
  let resolve!: (task: never) => void;
  createTask.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  return () =>
    resolve({
      id: "old-draft",
      title: "Draft",
      status: "planned",
      projectId: "project-2",
      createdAt: "2026-08-05T00:00:00.000Z",
    } as never);
}

describe("CreateTaskModal context isolation", () => {
  it("never falls back to the last globally visited project", () => {
    storedProject = { id: "foreign-project", columns: [] };
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle();
    expect(
      screen.getByText("common:modals.createTask.createButton"),
    ).toBeDisabled();
    submit();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("clears selected project and private fields after close and reopen", async () => {
    const props = { open: true, onClose: vi.fn() };
    const view = render(<CreateTaskModal {...props} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    view.rerender(<CreateTaskModal {...props} open={false} />);
    view.rerender(<CreateTaskModal {...props} />);
    expect(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
    ).toHaveValue("");
    enterTitle("New task");
    submit();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("clears workspace A's selection when workspace B becomes active", async () => {
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    workspaceId = "workspace-2";
    projects = [{ id: "project-3", name: "Gamma", slug: "gam" }];
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-2",
    });
    view.rerender(<CreateTaskModal open onClose={vi.fn()} />);
    enterTitle("Workspace B secret");
    submit();
    expect(createTask).not.toHaveBeenCalled();
    expect(
      screen.getByText("common:modals.createTask.selectProject"),
    ).toBeInTheDocument();
  });

  it("does not expose the previous workspace while the route's workspace is loading", async () => {
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-2",
    });
    view.rerender(<CreateTaskModal open onClose={vi.fn()} />);
    expect(screen.queryByTestId("description-editor")).toBeNull();
    expect(createTask).not.toHaveBeenCalled();
  });

  it.each([undefined, []])(
    "rejects explicit project IDs until current workspace query proves membership (%s)",
    async (data) => {
      projects = data;
      render(<CreateTaskModal open projectId="project-2" onClose={vi.fn()} />, {
        wrapper: createWrapper(),
      });
      enterTitle();
      submit();
      await expect(ensureTaskId?.()).resolves.toBeNull();
      expect(createTask).not.toHaveBeenCalled();
    },
  );

  it("deletes a late draft after navigation without handing its ID to an upload", async () => {
    const finish = pendingCreate();
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    let pending!: Promise<string | null>;
    act(() => {
      pending = ensureTaskId?.() as Promise<string | null>;
    });
    workspaceId = "workspace-2";
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-2",
    });
    view.rerender(<CreateTaskModal open onClose={vi.fn()} />);
    await act(async () => {
      finish();
      await pending;
    });
    await expect(pending).resolves.toBeNull();
    expect(deleteTask).toHaveBeenCalledExactlyOnceWith("old-draft");
    expect(screen.getByTestId("description-editor")).not.toHaveAttribute(
      "data-task-id",
    );
    expect(updateTask).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
  });

  it("waits for the upload draft on submit and saves that task only once", async () => {
    const finish = pendingCreate();
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    let pending!: Promise<string | null>;
    act(() => {
      pending = ensureTaskId?.() as Promise<string | null>;
    });
    submit();
    submit();
    expect(updateTask).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    await vi.waitFor(() =>
      expect(updateTask).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: "old-draft",
          projectId: "project-2",
          title: "Private task",
        }),
      ),
    );
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("discards an existing draft on close and never puts it into another project's store", async () => {
    storedProject = { id: "project-1", columns: [] };
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    await act(async () => {
      await ensureTaskId?.();
    });
    view.rerender(<CreateTaskModal open={false} onClose={vi.fn()} />);
    expect(deleteTask).toHaveBeenCalledExactlyOnceWith("task-1");
    expect(setProject).not.toHaveBeenCalled();
  });
});

describe("CreateTaskModal assignees", () => {
  beforeEach(() => {
    members = [
      { userId: "ana", user: { name: "Ana Silva", image: null } },
      { userId: "ben", user: { name: "Ben Ito", image: null } },
    ];
  });

  async function pickAnaAndBen() {
    fireEvent.click(screen.getByText("common:modals.createTask.assign"));
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: /Ana Silva/ }),
    );
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Ben Ito/ }));
  }

  it("creates the task with every picked person, in order", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    enterTitle("Two owners");
    await pickAnaAndBen();
    submit();

    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Two owners",
          assigneeIds: ["ana", "ben"],
        }),
      ),
    );
  });

  it("saves the picked people on the upload draft too", async () => {
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle("Drafted");
    await pickAnaAndBen();
    await act(async () => {
      await ensureTaskId?.();
    });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeIds: ["ana", "ben"] }),
    );

    submit();
    await vi.waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task-1",
          userId: "ana",
          replaceAssigneeIds: ["ana", "ben"],
        }),
      ),
    );
  });

  it("starts the next task unassigned with Create more", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.createMore"));
    enterTitle("First");
    await pickAnaAndBen();
    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));

    await vi.waitFor(() =>
      expect(
        screen.getByText("common:modals.createTask.assign"),
      ).toBeInTheDocument(),
    );
    enterTitle("Second");
    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(createTask.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ title: "Second", assigneeIds: [] }),
    );
  });

  it("counts picked people as unsaved input", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    await pickAnaAndBen();
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
  });
});

function clickBackdrop() {
  const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
  fireEvent.pointerDown(backdrop as Element);
  fireEvent.pointerUp(backdrop as Element);
  fireEvent.click(backdrop as Element);
}

const saveAsDraftButton = () =>
  screen.getByRole("button", { name: /common:modals.createTask.saveAsDraft/ });

describe("CreateTaskModal parent", () => {
  beforeEach(() => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    columns = [
      { slug: "ready", name: "Ready", position: 0, group: "unstarted" },
    ];
  });

  function chooseParent() {
    fireEvent.click(screen.getByRole("button", { name: "tasks:parent.add" }));
    fireEvent.click(screen.getByRole("button", { name: /ALP-7/ }));
  }

  it("creates the task under the chosen parent in one call", async () => {
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    chooseParent();
    expect(
      screen.getByRole("button", { name: "tasks:parent.tooltip" }),
    ).toHaveTextContent("ALP-7");

    enterTitle("Child task");
    submit();

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          parentId: "parent-1",
        }),
      );
    });
    expect(setTaskParent).not.toHaveBeenCalled();
  });

  it("sends no parent when none is chosen", async () => {
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Plain task");
    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0]?.[0]?.parentId).toBeUndefined();
  });

  it("saves the chosen parent with Save as draft", async () => {
    const onClose = vi.fn();
    render(<CreateTaskModal open onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Child task");
    chooseParent();
    expect(saveAsDraftButton()).toBeEnabled();
    fireEvent.click(saveAsDraftButton());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createDraft).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      fields: expect.objectContaining({
        projectId: "project-1",
        parentTaskId: "parent-1",
      }),
    });
  });

  it("hides the parent picker without task:update", () => {
    canUpdateTasks = false;
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    expect(
      screen.queryByRole("button", { name: "tasks:parent.add" }),
    ).not.toBeInTheDocument();
  });
});

describe("CreateTaskModal similar tasks", () => {
  beforeEach(() => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
  });

  it("hints at open tasks like the title, and can be dismissed", async () => {
    similarTasks = [{ id: "task-9", key: "ALP-9", title: "Login page broken" }];
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Login page is broken");
    expect(useSimilarTasks).toHaveBeenLastCalledWith(
      "project-1",
      "Login page is broken",
      true,
    );
    const open = screen.getByRole("link", {
      name: "tasks:create.similarOpenLabel",
    });
    expect(open).toHaveAttribute(
      "href",
      "/dashboard/workspace/workspace-1/project/project-1/task/task-9",
    );
    expect(open).toHaveAttribute("target", "_blank");

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:create.similarDismiss" }),
    );
    expect(
      screen.queryByRole("link", { name: "tasks:create.similarOpenLabel" }),
    ).not.toBeInTheDocument();

    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalled());
  });

  it("links the new task as a duplicate of a hint, or not after undo", async () => {
    similarTasks = [{ id: "task-9", key: "ALP-9", title: "Login page broken" }];
    createTaskRelation.mockClear();
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Login page is broken");
    fireEvent.click(
      screen.getByRole("button", { name: "ai:duplicates.markLabel" }),
    );
    expect(screen.getByText("ai:duplicates.willLink")).toBeInTheDocument();
    // Dismissing the hints keeps the choice.
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:create.similarDismiss" }),
    );
    expect(screen.getByText("ai:duplicates.willLink")).toBeInTheDocument();

    submit();
    await vi.waitFor(() =>
      expect(createTaskRelation).toHaveBeenCalledWith({
        sourceTaskId: "task-1",
        targetTaskId: "task-9",
        relationType: "duplicate",
      }),
    );
  });

  it("offers no duplicate link without task:update", () => {
    canUpdateTasks = false;
    similarTasks = [{ id: "task-9", key: "ALP-9", title: "Login page broken" }];
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Login page is broken");
    expect(
      screen.queryByRole("button", { name: "ai:duplicates.markLabel" }),
    ).not.toBeInTheDocument();
  });
});

describe("CreateTaskModal save as draft", () => {
  it("is disabled with an empty form and enabled after typing", () => {
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    expect(saveAsDraftButton()).toBeDisabled();
    enterTitle("Half an idea");
    expect(saveAsDraftButton()).toBeEnabled();
  });

  it("is disabled once the dialog created its upload task", async () => {
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    await act(async () => {
      await ensureTaskId?.();
    });
    expect(saveAsDraftButton()).toBeDisabled();
  });

  it("saves the form as a draft and closes, even with Create more on", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    const onClose = vi.fn();
    render(<CreateTaskModal open status="doing" onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    fireEvent.click(screen.getByText("common:modals.createTask.createMore"));
    enterTitle("Draft me");

    fireEvent.click(saveAsDraftButton());

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createDraft).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      fields: expect.objectContaining({
        projectId: "project-1",
        title: "Draft me",
        status: "doing",
        priority: "no-priority",
        cycleId: null,
        moduleIds: [],
        estimatePointId: null,
      }),
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when saving fails", async () => {
    createDraft.mockRejectedValueOnce(new Error("Too many drafts"));
    const onClose = vi.fn();
    render(<CreateTaskModal open onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Draft me");
    fireEvent.click(saveAsDraftButton());
    await vi.waitFor(() => expect(createDraft).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers Save as draft in the discard confirmation", async () => {
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Unsaved");
    clickBackdrop();
    const title = await screen.findByText(
      "common:modals.createTask.discardTitle",
    );
    const confirmation = title.closest('[role="alertdialog"]') as HTMLElement;
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: /common:modals.createTask.saveAsDraft/,
      }),
    );
    await vi.waitFor(() => expect(createDraft).toHaveBeenCalledTimes(1));
  });

  it("makes Save as draft the primary action from the Drafts page", () => {
    render(<CreateTaskModal open primaryAction="draft" onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle("New draft");
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(createTask).not.toHaveBeenCalled();
    return vi.waitFor(() => expect(createDraft).toHaveBeenCalledTimes(1));
  });
});

const storedDraft = {
  id: "draft-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  project: {
    id: "project-1",
    name: "Alpha",
    slug: "alp",
    icon: null,
    archived: false,
  },
  title: "Stored title",
  description: "",
  status: null,
  priority: "high",
  assigneeIds: [],
  labels: [{ name: "bug", color: "red" }],
  startDate: null,
  dueDate: null,
  customFieldValues: [],
  cycleId: "cycle-1",
  moduleIds: [],
  estimatePointId: null,
  parentTaskId: null,
  parentTask: null,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

describe("CreateTaskModal draft editor", () => {
  it("shows the draft's actions instead of creating", () => {
    render(<CreateTaskModal open draft={storedDraft} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText("tasks:drafts.editor.title")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
    ).toHaveValue("Stored title");
    expect(
      screen.getByText("tasks:drafts.editor.saveDraft"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("tasks:drafts.editor.deleteDraft"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("common:modals.createTask.createButton"),
    ).toBeNull();
    expect(
      screen.queryByText("common:modals.createTask.createMore"),
    ).toBeNull();
  });

  it("disables Publish without a title", () => {
    render(
      <CreateTaskModal
        open
        draft={{ ...storedDraft, title: "" }}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() },
    );
    expect(
      screen.getByRole("button", { name: "tasks:drafts.editor.publish" }),
    ).toBeDisabled();
  });

  it("disables Publish without a project", () => {
    render(
      <CreateTaskModal
        open
        draft={{ ...storedDraft, projectId: null, project: null }}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() },
    );
    expect(
      screen.getByRole("button", { name: "tasks:drafts.editor.publish" }),
    ).toBeDisabled();
  });

  it("saves only the changed fields", async () => {
    const onClose = vi.fn();
    render(<CreateTaskModal open draft={storedDraft} onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Better title");
    fireEvent.click(screen.getByText("tasks:drafts.editor.saveDraft"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(updateDraft).toHaveBeenCalledWith({
      id: "draft-1",
      workspaceId: "workspace-1",
      fields: { title: "Better title" },
    });
  });

  it("closes without a request when nothing changed", async () => {
    const onClose = vi.fn();
    render(<CreateTaskModal open draft={storedDraft} onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    fireEvent.click(screen.getByText("tasks:drafts.editor.saveDraft"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("publishes with the unsaved edits as the patch", async () => {
    const onClose = vi.fn();
    render(<CreateTaskModal open draft={storedDraft} onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Ready");
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(publishDraft).toHaveBeenCalledWith("draft-1", { title: "Ready" });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("stays open when publishing is refused", async () => {
    publishDraft.mockResolvedValueOnce("refused");
    const onClose = vi.fn();
    render(<CreateTaskModal open draft={storedDraft} onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await vi.waitFor(() => expect(publishDraft).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses uploads, which need a published task", async () => {
    render(<CreateTaskModal open draft={storedDraft} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await expect(ensureTaskId?.()).resolves.toBeNull();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("asks to save changes when closing with edits", async () => {
    render(<CreateTaskModal open draft={storedDraft} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle("Edited");
    clickBackdrop();
    expect(
      await screen.findByText("tasks:drafts.editor.unsavedTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("tasks:drafts.editor.discardChanges"),
    ).toBeInTheDocument();
  });

  it("closes at once when nothing changed", () => {
    const onClose = vi.fn();
    render(<CreateTaskModal open draft={storedDraft} onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    clickBackdrop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

let taskTemplates: Array<Record<string, unknown>> = [];
vi.mock("@/hooks/queries/task-template/use-task-templates", () => ({
  useTaskTemplates: () => ({ data: taskTemplates }),
}));
vi.mock("@/hooks/queries/estimate/use-active-estimate", () => ({
  useActiveEstimate: () => ({ pointsById: new Map() }),
}));

describe("CreateTaskModal task templates", () => {
  const bugTemplate = {
    id: "tpl-1",
    name: "Bug report",
    titlePattern: "Bug: {title}",
    description: "",
    priority: "high",
    assigneeIds: [],
    labels: [],
    column: { id: "col-doing", name: "Doing", slug: "doing" },
    estimatePointId: null,
    subtasks: ["Reproduce", "Fix"],
  };

  beforeEach(() => {
    taskTemplates = [];
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    columns = [
      { slug: "doing", name: "Doing", position: 0, group: "started" },
      { slug: "ready", name: "Ready", position: 1, group: "unstarted" },
    ];
  });

  it("stays out of the way when the project has no templates", () => {
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    expect(
      screen.queryByRole("button", { name: "templates:use.menuLabel" }),
    ).not.toBeInTheDocument();
  });

  it("fills the form and creates the checklist under the new task", async () => {
    taskTemplates = [bugTemplate];
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle("crash");
    fireEvent.click(
      screen.getByRole("button", { name: "templates:use.menuLabel" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Bug report/ }),
    );

    expect(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
    ).toHaveValue("Bug: crash");
    const checklist = screen.getByRole("region", {
      name: "templates:use.subtasksTitle",
    });
    // The first row is "Reproduce"; removing it leaves "Fix".
    const [removeFirst] = within(checklist).getAllByRole("button", {
      name: "templates:use.removeSubtask",
    });
    if (!removeFirst) throw new Error("no checklist rows");
    fireEvent.click(removeFirst);

    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({
      title: "Bug: crash",
      status: "doing",
      priority: "high",
      projectId: "project-1",
    });
    expect(createTask.mock.calls[1]?.[0]).toMatchObject({
      title: "Fix",
      parentId: "task-1",
      status: "ready",
    });
  });

  it("leaves the checklist out without task:update", async () => {
    canUpdateTasks = false;
    taskTemplates = [bugTemplate];
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "templates:use.menuLabel" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Bug report/ }),
    );
    expect(
      screen.queryByRole("region", { name: "templates:use.subtasksTitle" }),
    ).not.toBeInTheDocument();
    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
  });
});
