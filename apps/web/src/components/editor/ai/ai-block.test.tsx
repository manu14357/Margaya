import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiBlockPanel, aiBlockSlashCommand, useAiBlock } from "./ai-block";

const m = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  reply: "- [ ] Ship it",
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "de-DE", language: "de-DE" },
  }),
}));
vi.mock("./ai-feedback-buttons", () => ({ default: () => null }));
vi.mock("@/fetchers/ai/writing", () => ({
  streamPageBlock: async (
    body: Record<string, unknown>,
    handlers: { onDelta?: (text: string) => void },
  ) => {
    m.calls.push(body);
    handlers.onDelta?.(m.reply);
    return m.reply;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  m.calls = [];
  m.reply = "- [ ] Ship it";
});

function Harness({ onEditor }: { onEditor: (editor: Editor) => void }) {
  const shellRef = useRef<HTMLElement | null>(null);
  const editor = useEditor({
    extensions: [StarterKit.configure({ trailingNode: false }), Markdown],
    content: "Launch plan\n\nWe launch on Friday.",
    contentType: "markdown",
  });
  const block = useAiBlock({ editor, workspaceId: "ws-1", pageId: "page-1" });
  useEffect(() => {
    if (editor) onEditor(editor);
  }, [editor, onEditor]);
  if (!editor) return null;
  const command = aiBlockSlashCommand(
    ((key: string) => key) as never,
    block.open,
  );
  return (
    <section ref={shellRef}>
      <button
        type="button"
        onClick={() => {
          const end = editor.state.doc.content.size;
          editor.commands.insertContentAt(end, { type: "paragraph" });
          const pos = editor.state.doc.content.size - 1;
          command.run(editor, { from: pos, to: pos });
        }}
      >
        open
      </button>
      <AiBlockPanel editor={editor} block={block} shellRef={shellRef} />
      <EditorContent editor={editor} />
    </section>
  );
}

async function mount() {
  let current: Editor | null = null;
  render(<Harness onEditor={(editor) => (current = editor)} />);
  await waitFor(() => expect(current).not.toBeNull());
  return current as unknown as Editor;
}

describe("AI block", () => {
  it("is a slash command in the insert group", () => {
    const command = aiBlockSlashCommand(
      ((key: string) => key) as never,
      vi.fn(),
    );
    expect(command).toMatchObject({
      id: "ai-block",
      label: "ai:writing.block.command",
      group: "insert",
    });
    expect(command.search).toContain("faq");
  });

  it("generates from the page and inserts only on Accept", async () => {
    const editor = await mount();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "ai:writing.block.presets.action_items",
      }),
    );
    expect(m.calls).toEqual([
      expect.objectContaining({
        workspaceId: "ws-1",
        pageId: "page-1",
        preset: "action_items",
        locale: "de-DE",
      }),
    ]);
    expect(m.calls[0]?.text).toContain("We launch on Friday.");
    await screen.findByText(/Ship it/);
    // A proposal only: the document is unchanged.
    expect(editor.getMarkdown()).not.toContain("Ship it");

    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.block.accept" }),
    );
    expect(editor.getMarkdown()).toContain("Ship it");
    expect(
      screen.queryByRole("region", { name: "ai:writing.block.title" }),
    ).toBeNull();
  });

  it("marks the proposal stale when the page changes, and discards cleanly", async () => {
    const editor = await mount();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "ai:writing.block.presets.tldr",
      }),
    );
    await screen.findByText(/Ship it/);
    act(() => {
      editor.commands.insertContentAt(1, "Big ");
    });
    expect(
      await screen.findByText("ai:writing.block.stale"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.block.regenerate" }),
    );
    await waitFor(() => expect(m.calls).toHaveLength(2));
    expect(screen.queryByText("ai:writing.block.stale")).toBeNull();

    const before = editor.getMarkdown();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "ai:writing.preview.discard",
      })[0] as HTMLElement,
    );
    expect(editor.getMarkdown()).toBe(before);
  });

  it("asks for an instruction for a custom block", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "ai:writing.block.presets.custom",
      }),
    );
    expect(m.calls).toHaveLength(0);
    const input = screen.getByRole("textbox", {
      name: "ai:writing.block.presets.custom",
    });
    fireEvent.change(input, { target: { value: "A haiku" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0]).toMatchObject({
      preset: "custom",
      instruction: "A haiku",
    });
  });
});
