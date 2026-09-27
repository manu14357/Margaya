import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Extension } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommentEditor from "./comment-editor";

const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
  editors: [] as unknown[],
  loadShiki: (() => {}) as (value: unknown) => void,
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
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }) }),
);

beforeEach(() => {
  mocks.editors.length = 0;
});
afterEach(cleanup);

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
