import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskAttachments from "./task-attachments";

const mocks = vi.hoisted(() => ({
  attachments: [] as unknown[],
  canUpdate: true,
  canDelete: false,
  upload: vi.fn(),
  remove: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "me" } }),
}));
vi.mock("@/hooks/queries/task-attachment/use-get-task-attachments", () => ({
  default: () => ({
    data: mocks.attachments,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  taskAttachmentsQueryKey: (taskId: string) => ["task-attachments", taskId],
}));
vi.mock("@/hooks/mutations/task-attachment/use-delete-task-attachment", () => ({
  default: () => ({ mutate: mocks.remove }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => mocks.canUpdate,
    canDeleteTasks: () => mocks.canDelete,
  }),
}));
vi.mock("@/lib/upload-task-attachment", () => ({
  StorageUploadError: class extends Error {},
  uploadTaskAttachment: mocks.upload,
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

function attachment(overrides: Record<string, unknown>) {
  return {
    id: "a-1",
    taskId: "task-1",
    filename: "spec.pdf",
    mimeType: "application/pdf",
    size: 2048,
    kind: "attachment",
    url: "https://api.example/api/asset/a-1",
    downloadUrl: "https://api.example/api/asset/a-1?download=1",
    createdBy: { id: "me", name: "Me", image: null },
    createdAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

function renderAttachments() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TaskAttachments taskId="task-1" />
    </QueryClientProvider>,
  );
}

function pick(files: File[]) {
  const input = screen.getByTestId("task-attachment-input");
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  mocks.attachments = [];
  mocks.canUpdate = true;
  mocks.canDelete = false;
  mocks.upload.mockResolvedValue(attachment({}));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskAttachments", () => {
  it("previews images and shows an icon for other files", () => {
    mocks.attachments = [
      attachment({
        id: "img",
        filename: "screen.png",
        mimeType: "image/png",
        kind: "image",
        url: "https://api.example/api/asset/img",
      }),
      attachment({}),
    ];
    renderAttachments();

    const image = screen.getByAltText("screen.png");
    expect(image).toHaveAttribute("src", "https://api.example/api/asset/img");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(screen.queryByAltText("spec.pdf")).toBeNull();
    // Only images get an "Open" action; every file can be downloaded.
    expect(
      screen.getAllByRole("link", { name: "tasks:attachments.open" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("link", { name: "tasks:attachments.download" }),
    ).toHaveLength(2);
  });

  it("lets the uploader delete their own file, and task deleters any file", () => {
    mocks.attachments = [
      attachment({ id: "mine" }),
      attachment({
        id: "theirs",
        filename: "other.pdf",
        createdBy: { id: "someone", name: "Someone", image: null },
      }),
    ];
    const deleteButtons = () =>
      screen.queryAllByRole("button", { name: "tasks:attachments.delete" });

    renderAttachments();
    expect(deleteButtons()).toHaveLength(1);
    cleanup();

    mocks.canDelete = true;
    renderAttachments();
    expect(deleteButtons()).toHaveLength(2);
    cleanup();

    mocks.canUpdate = false;
    mocks.canDelete = false;
    renderAttachments();
    expect(deleteButtons()).toHaveLength(0);
  });

  it("shows a pending row while a file uploads", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.upload.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderAttachments();

    pick([new File(["data"], "notes.txt", { type: "text/plain" })]);

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("tasks:attachments.uploading")).toBeInTheDocument();

    await act(async () => finish(attachment({})));
    await waitFor(() =>
      expect(screen.queryByText("tasks:attachments.uploading")).toBeNull(),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "tasks:attachments.toast.attached",
    );
  });

  it("keeps the first 10 files of a larger pick and says so", async () => {
    renderAttachments();
    const files = Array.from(
      { length: 11 },
      (_, index) => new File(["x"], `file-${index}.txt`),
    );

    pick(files);

    expect(mocks.toast.warning).toHaveBeenCalledWith(
      "tasks:attachments.toast.tooMany",
    );
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(10));
    expect(
      mocks.upload.mock.calls.map(([args]) => (args as { file: File }).file),
    ).not.toContain(files[10]);
  });

  it("skips empty files with a notice", async () => {
    renderAttachments();

    pick([new File([], "empty.txt"), new File(["x"], "full.txt")]);

    expect(mocks.toast.error).toHaveBeenCalledWith(
      "tasks:attachments.toast.empty",
    );
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect((mocks.upload.mock.calls[0][0] as { file: File }).file.name).toBe(
      "full.txt",
    );
  });
});
