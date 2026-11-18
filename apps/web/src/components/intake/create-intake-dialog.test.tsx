import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateIntakeDialog from "./create-intake-dialog";
import { intakeItem } from "./intake-test-fixtures";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  upload: vi.fn(),
  analyze: vi.fn(),
  prepare: vi.fn(),
  editorUpload: vi.fn(),
  canUpdateTasks: true,
  aiAvailable: false,
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => api.canUpdateTasks }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: api.aiAvailable }),
}));
vi.mock("@/lib/upload-task-attachment", () => ({
  uploadTaskAttachment: api.upload,
}));
vi.mock("@/fetchers/ai/capture", () => ({ analyzeCapture: api.analyze }));
// Canvas re-encoding is browser-only; pasted files pass through as is.
vi.mock("@/lib/ai/capture-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/capture-media")>()),
  prepareCaptureImage: api.prepare,
  releaseCaptureImages: vi.fn(),
}));

// Dialogs and menus render slowly on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/fetchers/intake/create-intake-item", () => ({
  default: api.create,
}));
vi.mock("@/fetchers/intake/update-intake-item", () => ({
  default: api.update,
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    success: api.toastSuccess,
    error: api.toastError,
    warning: vi.fn(),
    info: api.toastInfo,
    loading: vi.fn(() => "toast-1"),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
}));
// The rich editor is out of scope here (comment-editor.test.tsx covers its
// uploads): this one shows what the dialog hands it, and offers an edit's
// description upload as the real one does.
vi.mock("@/components/task/task-description-editor", () => ({
  default: function DescriptionEditor({
    value,
    onChange,
    taskId,
    allowFileUploads = true,
    onQueueFiles,
    onUploadFilesChange,
  }: {
    value: string;
    onChange: (value: string) => void;
    taskId?: string;
    allowFileUploads?: boolean;
    onQueueFiles?: (files: File[]) => void;
    onUploadFilesChange?: (upload: ((files: File[]) => void) | null) => void;
  }) {
    useEffect(() => {
      onUploadFilesChange?.(api.editorUpload);
      return () => onUploadFilesChange?.(null);
    }, [onUploadFilesChange]);
    return (
      <textarea
        aria-label="description"
        data-task-id={taskId ?? "none"}
        data-uploads={String(allowFileUploads)}
        data-queues={onQueueFiles ? "yes" : "no"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.canUpdateTasks = true;
  api.aiAvailable = false;
});

function pasteScreenshot() {
  const file = new File(["png"], "shot.png", { type: "image/png" });
  api.prepare.mockResolvedValue({
    id: "capture-1",
    name: "shot.png",
    file,
    mediaType: "image/png",
    data: "cG5n",
    url: "blob:shot",
  });
  fireEvent.paste(screen.getByLabelText("description"), {
    clipboardData: { files: [file] },
  });
  return file;
}

function renderDialog(
  props: Partial<Parameters<typeof CreateIntakeDialog>[0]> = {},
) {
  const onOpenChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateIntakeDialog
        open
        onOpenChange={onOpenChange}
        projectId="p1"
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const titleInput = () =>
  screen.getByRole("textbox", { name: "intake:create.titlePlaceholder" });
const submitButton = () =>
  screen.getByRole("button", { name: "intake:create.submit" });

describe("CreateIntakeDialog pasted images", () => {
  it("attaches pasted screenshots once the request is filed", async () => {
    api.create.mockResolvedValue(intakeItem());
    api.upload.mockResolvedValue({});
    renderDialog();
    const file = pasteScreenshot();
    expect(await screen.findByAltText("shot.png")).toBeInTheDocument();
    // No AI: no draft action.
    expect(
      screen.queryByRole("button", { name: "ai:capture.draftFromImages" }),
    ).toBeNull();
    fireEvent.change(titleInput(), { target: { value: "Export fails" } });
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(api.upload).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1", file }),
      ),
    );
  });

  it("drafts the request from pasted screenshots when AI is on", async () => {
    api.aiAvailable = true;
    api.analyze.mockResolvedValue({
      projectId: "p1",
      source: "screenshot",
      items: [
        {
          kind: "bug",
          title: "Export button does nothing",
          summary: "Clicking Export shows no file.",
          steps: ["Open a report", "Click Export"],
          expected: "A CSV downloads",
          actual: null,
          environment: null,
          priority: "high",
          priorityReason: "Blocks reporting",
          labels: [],
          owner: null,
        },
      ],
    });
    renderDialog();
    pasteScreenshot();
    fireEvent.click(
      await screen.findByRole("button", { name: "ai:capture.draftFromImages" }),
    );
    await waitFor(() =>
      expect(titleInput()).toHaveValue("Export button does nothing"),
    );
    expect(api.analyze.mock.calls[0]?.[0]).toEqual({
      projectId: "p1",
      body: {
        source: "screenshot",
        images: [{ mediaType: "image/png", data: "cG5n" }],
      },
    });
    expect(screen.getByLabelText("description")).toHaveValue(
      "Clicking Export shows no file.\n\n**ai:capture.sections.steps**\n1. Open a report\n2. Click Export\n\n**ai:capture.sections.expected**\nA CSV downloads",
    );
  });

  it("leaves pasting alone without permission to edit tasks", () => {
    api.canUpdateTasks = false;
    renderDialog();
    pasteScreenshot();
    expect(api.prepare).not.toHaveBeenCalled();
    expect(screen.queryByText("intake:create.fileHint")).toBeNull();
  });
});

const pdf = () => new File(["%PDF"], "spec.pdf", { type: "application/pdf" });
const notes = () => new File(["notes"], "notes.txt", { type: "text/plain" });

function dropFiles(target: Element, files: File[]) {
  fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
}

describe("CreateIntakeDialog files", () => {
  it("queues dropped and picked files, then attaches them once filed", async () => {
    api.create.mockResolvedValue(intakeItem());
    api.upload.mockResolvedValue({});
    renderDialog();
    expect(screen.getByLabelText("description")).toHaveAttribute(
      "data-queues",
      "yes",
    );
    expect(screen.getByText("intake:create.fileHint")).toBeInTheDocument();

    // Dropped anywhere on the dialog, not only on the editor.
    const first = pdf();
    dropFiles(titleInput(), [first]);
    const second = notes();
    fireEvent.change(screen.getByTestId("intake-file-input"), {
      target: { files: [second] },
    });

    expect(await screen.findByText("spec.pdf")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.toastError).not.toHaveBeenCalled();

    fireEvent.change(titleInput(), { target: { value: "Export fails" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    expect(api.upload.mock.calls.map(([args]) => args.file)).toEqual([
      first,
      second,
    ]);
    expect(api.upload.mock.calls[0]?.[0].taskId).toBe("task-1");
  });

  it("lets a queued file be removed before filing", async () => {
    api.create.mockResolvedValue(intakeItem());
    renderDialog();
    dropFiles(titleInput(), [pdf()]);
    fireEvent.click(
      await screen.findByRole("button", { name: "intake:create.removeImage" }),
    );
    expect(screen.queryByText("spec.pdf")).toBeNull();
    fireEvent.change(titleInput(), { target: { value: "Export fails" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("uploads into the saved request's description when editing", async () => {
    renderDialog({ intakeItem: intakeItem(), description: "Steps" });
    // The request is saved: the editor gets its task and uploads.
    const editor = screen.getByLabelText("description");
    expect(editor).toHaveAttribute("data-task-id", "task-1");
    expect(editor).toHaveAttribute("data-uploads", "true");
    expect(editor).toHaveAttribute("data-queues", "no");

    const files = [pdf(), notes()];
    dropFiles(titleInput(), files);
    expect(api.editorUpload).toHaveBeenCalledWith(files);

    fireEvent.click(
      screen.getByRole("button", { name: "intake:create.attachFiles" }),
    );
    const picked = [notes()];
    fireEvent.change(screen.getByTestId("intake-file-input"), {
      target: { files: picked },
    });
    expect(api.editorUpload).toHaveBeenLastCalledWith(picked);
    expect(api.toastError).not.toHaveBeenCalled();
  });

  it("lets the requester upload into their request without task:update", () => {
    // Edit request is the requester's dialog: viewers file and edit requests.
    api.canUpdateTasks = false;
    renderDialog({ intakeItem: intakeItem(), description: "Steps" });
    expect(screen.getByLabelText("description")).toHaveAttribute(
      "data-uploads",
      "true",
    );
    const files = [pdf()];
    dropFiles(titleInput(), files);
    expect(api.editorUpload).toHaveBeenCalledWith(files);
  });

  it("explains, without task:update, that a new request takes files later", () => {
    api.canUpdateTasks = false;
    renderDialog();
    expect(screen.getByLabelText("description")).toHaveAttribute(
      "data-uploads",
      "false",
    );
    expect(
      screen.queryByRole("button", { name: "intake:create.attachFiles" }),
    ).toBeNull();
    dropFiles(titleInput(), [pdf()]);
    expect(api.toastInfo).toHaveBeenCalledWith(
      "intake:create.filesAfterSubmit",
    );
    expect(screen.queryByText("spec.pdf")).toBeNull();
  });
});

describe("CreateIntakeDialog", () => {
  it("needs a title, and has no task for uploads until filed", () => {
    renderDialog();
    expect(submitButton()).toBeDisabled();
    fireEvent.change(titleInput(), { target: { value: "  " } });
    expect(submitButton()).toBeDisabled();
    expect(screen.getByLabelText("description")).toHaveAttribute(
      "data-task-id",
      "none",
    );
  });

  it("submits with Ctrl+Enter and closes", async () => {
    api.create.mockResolvedValue(intakeItem());
    const { onOpenChange } = renderDialog();
    fireEvent.change(titleInput(), { target: { value: "Export fails" } });
    fireEvent.keyDown(titleInput(), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("p1", {
        title: "Export fails",
        description: "",
        priority: "no-priority",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.toastSuccess).toHaveBeenCalled();
  });

  it("clears and stays open with Create more", async () => {
    api.create.mockResolvedValue(intakeItem());
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(titleInput(), { target: { value: "First" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(titleInput()).toHaveValue(""));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("prefills an edit and saves through the update route", async () => {
    api.update.mockResolvedValue(intakeItem());
    const { onOpenChange } = renderDialog({
      intakeItem: intakeItem(),
      description: "Steps",
    });
    expect(titleInput()).toHaveValue("Export fails on Safari");
    expect(screen.getByLabelText("description")).toHaveValue("Steps");
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.change(titleInput(), { target: { value: "Export fails" } });
    fireEvent.click(screen.getByRole("button", { name: "intake:create.save" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("item-1", {
        title: "Export fails",
        description: "Steps",
        priority: "high",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("asks before discarding what was typed", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(titleInput(), { target: { value: "Draft" } });
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(
      await screen.findByText("intake:create.discardTitle"),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "intake:create.discard" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes at once when nothing was typed", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
