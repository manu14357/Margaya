import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type Editor, Extension } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import { Slice } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommentEditor from "./comment-editor";

const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
  editors: [] as unknown[],
  loadShiki: (() => {}) as (value: unknown) => void,
  uploadTaskImage: vi.fn(),
  toast: {
    loading: vi.fn(() => "toast-1"),
    update: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function inert(name: string) {
  return Extension.create({ name });
}

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      if (editor && !mocks.editors.includes(editor)) mocks.editors.push(editor);
      return editor;
    },
  };
});
vi.mock("@/components/task/extensions/shiki-code-block", () => ({
  ShikiCodeBlock: inert("shikiCodeBlockStub"),
  SHIKI_CODEBLOCK_REFRESH_META: "shikiRefresh",
}));
vi.mock("@/components/task/extensions/mermaid-block", () => ({
  MermaidBlock: inert("mermaidBlockStub"),
}));
vi.mock("@/components/task/extensions/embed-block", () => ({
  EmbedBlock: inert("embedBlockStub"),
}));
vi.mock("@/components/task/extensions/attachment-card", () => ({
  AttachmentCard: inert("attachmentCardStub"),
}));
vi.mock("@/components/task/extensions/margaya-issue-link", () => ({
  MargayaIssueLink: inert("margayaIssueLinkStub"),
}));
vi.mock("@/components/task/extensions/task-item-with-checkbox", () => ({
  TaskItemWithCheckbox: TaskItem,
}));
vi.mock("@/lib/shiki-highlighter", () => ({
  getSharedShikiHighlighter: () =>
    new Promise((resolve) => {
      mocks.loadShiki = resolve;
    }),
}));
vi.mock("shiki", () => ({ bundledLanguages: { typescript: {} } }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/lib/upload-task-image", () => ({
  uploadTaskImage: mocks.uploadTaskImage,
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }) }),
);

beforeEach(() => {
  mocks.editors.length = 0;
  mocks.uploadTaskImage.mockImplementation(
    async ({ file }: { file: File }) => ({
      url: `https://files.example/${file.name}`,
      alt: file.name,
      filename: file.name,
      kind: "image",
      mimeType: "image/png",
      size: file.size,
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const png = (name: string) => new File(["png"], name, { type: "image/png" });

async function mountedEditor() {
  await waitFor(() => expect(mocks.editors.length).toBeGreaterThan(0));
  const editor = mocks.editors.at(-1) as Editor;
  // jsdom has no layout to place a drop by.
  editor.view.posAtCoords = () => null;
  return editor;
}

/** Runs the editor's own drop handling, as ProseMirror does on a drop. */
function dropOnText(editor: Editor, files: File[]) {
  const event = {
    dataTransfer: { files },
    clientX: 0,
    clientY: 0,
    preventDefault: vi.fn(),
  } as unknown as DragEvent;
  return editor.view.someProp("handleDrop", (handle) =>
    handle(editor.view, event, Slice.empty, false),
  );
}

function pasteIntoText(editor: Editor, files: File[]) {
  const event = {
    clipboardData: { files, getData: () => "" },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
  return editor.view.someProp("handlePaste", (handle) =>
    handle(editor.view, event, Slice.empty),
  );
}

const uploadedNames = () =>
  mocks.uploadTaskImage.mock.calls.map((call) => {
    const args = call[0] as { taskId: string; file: File };
    return [args.taskId, args.file.name];
  });

describe("CommentEditor", () => {
  it("loads its value without reporting a change", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <CommentEditor value="Stored text" onChange={onChange} />,
    );
    await waitFor(() => expect(container.textContent).toContain("Stored text"));
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the same editor, and its text, when Shiki finishes loading", async () => {
    const { container } = render(
      <CommentEditor value="Typed early" onChange={vi.fn()} />,
    );
    await waitFor(() => expect(mocks.editors.length).toBe(1));
    const editor = mocks.editors[0];

    await act(async () => mocks.loadShiki({}));
    await act(async () => {});

    expect(mocks.editors.at(-1)).toBe(editor);
    expect(container.textContent).toContain("Typed early");
  });
});

describe("CommentEditor files", () => {
  it("uploads every dropped file into a saved task, in order", async () => {
    render(<CommentEditor value="" onChange={vi.fn()} taskId="task-1" />);
    const editor = await mountedEditor();

    let handled: unknown;
    act(() => {
      handled = dropOnText(editor, [png("a.png"), png("b.png"), png("c.png")]);
    });

    expect(handled).toBe(true);
    await waitFor(() => expect(mocks.uploadTaskImage).toHaveBeenCalledTimes(3));
    expect(uploadedNames()).toEqual([
      ["task-1", "a.png"],
      ["task-1", "b.png"],
      ["task-1", "c.png"],
    ]);
    await waitFor(() =>
      expect(editor.getHTML().match(/<img/g)?.length ?? 0).toBe(3),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "tasks:attachments.toast.attached",
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("uploads every pasted file", async () => {
    render(<CommentEditor value="" onChange={vi.fn()} taskId="task-1" />);
    const editor = await mountedEditor();

    act(() => {
      pasteIntoText(editor, [png("one.png"), png("two.png")]);
    });

    await waitFor(() => expect(mocks.uploadTaskImage).toHaveBeenCalledTimes(2));
    expect(uploadedNames()).toEqual([
      ["task-1", "one.png"],
      ["task-1", "two.png"],
    ]);
  });

  it("uploads every picked file", async () => {
    render(<CommentEditor value="" onChange={vi.fn()} taskId="task-1" />);
    await mountedEditor();

    fireEvent.change(screen.getByTestId("comment-editor-file-input"), {
      target: { files: [png("x.png"), png("y.png")] },
    });

    await waitFor(() => expect(mocks.uploadTaskImage).toHaveBeenCalledTimes(2));
  });

  it("takes a drop on the editor's frame around the text", async () => {
    const { container } = render(
      <CommentEditor value="" onChange={vi.fn()} taskId="task-1" />,
    );
    await mountedEditor();
    const files = [png("frame.png")];
    const shell = container.querySelector("section") as HTMLElement;

    fireEvent.drop(shell, {
      dataTransfer: {
        files,
        items: files.map(() => ({ kind: "file" })),
        types: ["Files"],
      },
    });

    await waitFor(() => expect(mocks.uploadTaskImage).toHaveBeenCalledTimes(1));
  });

  it("hands files to the caller while there is no task to hold them", async () => {
    const onQueueFiles = vi.fn();
    render(
      <CommentEditor value="" onChange={vi.fn()} onQueueFiles={onQueueFiles} />,
    );
    const editor = await mountedEditor();
    const files = [png("a.png"), png("b.png")];

    act(() => {
      dropOnText(editor, files);
    });

    expect(onQueueFiles).toHaveBeenCalledWith(files);
    expect(mocks.uploadTaskImage).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    // The attach button stays: picked files wait the same way.
    expect(
      screen.getByRole("button", { name: "activity:comment.attachFile" }),
    ).toBeInTheDocument();
  });

  it("leaves the refusal to ensureTaskId instead of a second error", async () => {
    const ensureTaskId = vi.fn(async () => null);
    render(
      <CommentEditor value="" onChange={vi.fn()} ensureTaskId={ensureTaskId} />,
    );
    const editor = await mountedEditor();

    act(() => {
      dropOnText(editor, [png("a.png")]);
    });

    await waitFor(() => expect(ensureTaskId).toHaveBeenCalled());
    await act(async () => {});
    expect(mocks.uploadTaskImage).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("offers no attach button where files have nowhere to go", async () => {
    render(<CommentEditor value="" onChange={vi.fn()} />);
    await mountedEditor();
    expect(
      screen.queryByRole("button", { name: "activity:comment.attachFile" }),
    ).toBeNull();
  });

  it("hands its upload to a drop zone around it", async () => {
    let upload: ((files: File[]) => void) | null = null;
    render(
      <CommentEditor
        value=""
        onChange={vi.fn()}
        taskId="task-1"
        onUploadFilesChange={(next) => {
          upload = next;
        }}
      />,
    );
    await mountedEditor();
    await waitFor(() => expect(upload).not.toBeNull());

    act(() => upload?.([png("zone-1.png"), png("zone-2.png")]));

    await waitFor(() => expect(mocks.uploadTaskImage).toHaveBeenCalledTimes(2));
  });
});
