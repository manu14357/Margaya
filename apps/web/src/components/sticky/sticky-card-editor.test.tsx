import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Extension } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sticky } from "@/fetchers/sticky/get-stickies";
import StickyCard from "./sticky-card";

// The real comment editor (only browser-only extensions are replaced), so
// the card's seeding and autosave run against a genuine Tiptap editor.
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  // Stable, like the real one: a new `t` per render rebuilds the editor.
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
// Shiki finishes loading when a test says so, as it does ~1 s after mount.
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
vi.mock("@/hooks/mutations/sticky/use-sticky-mutations", () => ({
  useUpdateSticky: () => ({ mutateAsync: mocks.save, mutate: vi.fn() }),
  useDeleteSticky: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// jsdom has no layout: autofocus scrolls the caret into view, which asks a
// Range for its rectangles. Without these the timer-driven scroll throws an
// unhandled error after some runs.
Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;

function sticky(id: string, content: string): Sticky {
  return {
    id,
    workspaceId: "w1",
    content,
    color: "yellow",
    position: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  } as Sticky;
}

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

function editorOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[contenteditable="true"]');
}

beforeEach(() => {
  mocks.save.mockReset();
  mocks.editors.length = 0;
});
afterEach(cleanup);

describe("StickyCard with the real editor", () => {
  it("shows stored notes and never writes them back", async () => {
    const { container, unmount } = render(
      <>
        <StickyCard sticky={sticky("a", "Alpha note")} workspaceId="w1" />
        <StickyCard sticky={sticky("b", "Beta note")} workspaceId="w1" />
      </>,
    );

    await wait(1200);
    expect(container.textContent).toContain("Alpha note");
    expect(container.textContent).toContain("Beta note");
    // Leaving the page flushes unsaved drafts; there are none.
    unmount();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("keeps a new sticky's text through its first save and Shiki loading", async () => {
    // The cache takes the saved row, as the update mutation does.
    function Harness() {
      const [current, setCurrent] = useState(sticky("new", ""));
      mocks.save.mockImplementation(async ({ changes }) => {
        const saved = { ...current, ...changes };
        setCurrent(saved);
        return saved;
      });
      return <StickyCard sticky={current} workspaceId="w1" autoFocus />;
    }
    const { container } = render(<Harness />);
    await waitFor(() => expect(editorOf(container)).not.toBeNull());
    const editor = mocks.editors.at(-1) as Editor;

    fireEvent.focus(editorOf(container) as HTMLElement);
    act(() => {
      editor.commands.insertContent("Buy oat milk");
    });
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ changes: { content: "Buy oat milk" } }),
      ),
    );

    await act(async () => mocks.loadShiki({}));
    await wait(1200);
    // The same editor keeps the text (and so the focus and caret).
    expect(mocks.editors.at(-1)).toBe(editor);
    expect(container.textContent).toContain("Buy oat milk");

    act(() => {
      editor.commands.insertContent(" and coffee");
    });
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          changes: { content: "Buy oat milk and coffee" },
        }),
      ),
    );
    expect(mocks.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ changes: { content: "" } }),
    );
  });
});
