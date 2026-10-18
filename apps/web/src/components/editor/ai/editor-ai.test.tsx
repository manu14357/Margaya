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
import { EditorAiBubbleButton } from "./editor-ai-menu";
import EditorAiPreview from "./editor-ai-preview";
import { useEditorAi } from "./use-editor-ai";

const m = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  reply: "Better text",
  error: null as null | { code: string; message: string },
  feedback: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "de-DE", language: "de-DE" },
  }),
}));
vi.mock("@/hooks/use-guest-locale", () => ({
  GUEST_LOCALES: [
    { code: "de-DE", nativeName: "Deutsch" },
    { code: "ja-JP", nativeName: "日本語" },
  ],
}));
vi.mock("@/hooks/mutations/ai/use-ai-assistant-mutations", () => ({
  useSendAiFeedback: () => ({
    isPending: false,
    mutate: (input: Record<string, unknown>) => m.feedback.push(input),
  }),
}));
vi.mock("@/fetchers/ai/writing", () => ({
  streamEditorAssist: async (
    body: Record<string, unknown>,
    handlers: {
      onMeta?: (meta: Record<string, unknown>) => void;
      onDelta?: (text: string) => void;
      onError?: (error: { code: string; message: string }) => void;
    },
  ) => {
    m.calls.push(body);
    handlers.onMeta?.({ provider: "fake", model: "fake-fast" });
    if (m.error) {
      handlers.onError?.(m.error);
      return "";
    }
    handlers.onDelta?.(m.reply);
    return m.reply;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  m.calls = [];
  m.reply = "Better text";
  m.error = null;
  m.feedback = [];
  window.localStorage.clear();
});

function Harness({ onEditor }: { onEditor: (editor: Editor) => void }) {
  const shellRef = useRef<HTMLElement | null>(null);
  const editor = useEditor({
    extensions: [StarterKit.configure({ trailingNode: false }), Markdown],
    content: "Hello **world**\n\nSecond paragraph",
    contentType: "markdown",
  });
  const ai = useEditorAi({
    editor,
    workspaceId: "ws-1",
    target: { kind: "page", id: "page-1" },
  });
  useEffect(() => {
    if (editor) onEditor(editor);
  }, [editor, onEditor]);
  if (!editor) return null;
  return (
    <section ref={shellRef}>
      <EditorAiBubbleButton editor={editor} ai={ai} />
      <EditorAiPreview editor={editor} ai={ai} shellRef={shellRef} />
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

async function runAction(
  editor: Editor,
  range: [number, number],
  label: string,
) {
  act(() => {
    editor.commands.setTextSelection({ from: range[0], to: range[1] });
  });
  fireEvent.click(screen.getByRole("button", { name: "ai:writing.menuLabel" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: label }));
}

describe("editor block AI", () => {
  it("streams a suggestion for the selection and replaces only that text", async () => {
    const editor = await mount();
    await runAction(editor, [1, 6], "ai:writing.actions.improve");

    expect(m.calls).toEqual([
      {
        workspaceId: "ws-1",
        target: { kind: "page", id: "page-1" },
        action: "improve",
        text: "Hello",
        locale: "de-DE",
      },
    ]);
    const suggestion = await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    expect(suggestion).toHaveValue("Better text");
    // Nothing is applied before the person chooses.
    expect(editor.getMarkdown()).toContain("Hello **world**");

    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.preview.replace/ }),
    );
    expect(editor.getMarkdown()).toContain("Better text **world**");
    expect(
      screen.queryByRole("region", { name: "ai:writing.preview.label" }),
    ).toBeNull();
  });

  it("lets the person edit the suggestion before inserting it below", async () => {
    const editor = await mount();
    await runAction(editor, [7, 12], "ai:writing.actions.summarize");
    const suggestion = await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    fireEvent.change(suggestion, { target: { value: "My own words" } });
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.preview.insertBelow/ }),
    );
    const markdown = editor.getMarkdown();
    expect(markdown).toContain("Hello **world**");
    expect(markdown.indexOf("My own words")).toBeGreaterThan(
      markdown.indexOf("world"),
    );
    expect(markdown.indexOf("My own words")).toBeLessThan(
      markdown.indexOf("Second paragraph"),
    );
  });

  it("discards without touching the document", async () => {
    const editor = await mount();
    const before = editor.getMarkdown();
    await runAction(editor, [1, 6], "ai:writing.actions.shorter");
    await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "ai:writing.preview.discard",
      })[0] as HTMLElement,
    );
    expect(editor.getMarkdown()).toBe(before);
    expect(
      screen.queryByRole("region", { name: "ai:writing.preview.label" }),
    ).toBeNull();
  });

  it("keeps the passage when someone else edits before it", async () => {
    const editor = await mount();
    await runAction(editor, [1, 6], "ai:writing.actions.fix");
    await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    // A co-editor's insertion lands before the passage.
    act(() => {
      editor.commands.insertContentAt(1, "Hey ");
    });
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.preview.replace/ }),
    );
    expect(editor.getMarkdown()).toContain("Hey Better text **world**");
  });

  it("asks for an instruction first for Ask AI", async () => {
    const editor = await mount();
    await runAction(editor, [1, 6], "ai:writing.actions.custom");
    expect(m.calls).toHaveLength(0);
    const input = await screen.findByRole("textbox", {
      name: "ai:writing.actions.custom",
    });
    fireEvent.change(input, { target: { value: "Make it a question" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0]).toMatchObject({
      action: "custom",
      instruction: "Make it a question",
      text: "Hello",
    });
  });

  it("translates into a UI language picked by its own name", async () => {
    const editor = await mount();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.menuLabel" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "ai:writing.actions.translate",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "日本語" }));
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0]).toMatchObject({
      action: "translate",
      language: "ja-JP",
    });
  });

  it("shows the AI error and offers a retry", async () => {
    m.error = { code: "AI_BUDGET_EXCEEDED", message: "limit" };
    const editor = await mount();
    await runAction(editor, [1, 6], "ai:writing.actions.longer");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ai:errors.AI_BUDGET_EXCEEDED",
    );
    m.error = null;
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.preview.retry" }),
    );
    expect(
      await screen.findByRole("textbox", {
        name: "ai:writing.preview.editLabel",
      }),
    ).toHaveValue("Better text");
  });

  it("rewrites in another tone from the preview and remembers it", async () => {
    const editor = await mount();
    await runAction(editor, [1, 6], "ai:writing.actions.improve");
    await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    expect(m.calls[0]).not.toHaveProperty("tone");
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.tone.professional" }),
    );
    await waitFor(() => expect(m.calls).toHaveLength(2));
    expect(m.calls[1]).toMatchObject({
      action: "improve",
      tone: "professional",
    });
    expect(window.localStorage.getItem("margaya:editor-ai-tone")).toBe(
      "professional",
    );
    expect(
      screen.getByRole("button", { name: "ai:writing.tone.professional" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("sends no tone with fixes and offers no tone switch", async () => {
    window.localStorage.setItem("margaya:editor-ai-tone", "casual");
    const editor = await mount();
    await runAction(editor, [1, 6], "ai:writing.actions.fix");
    await screen.findByRole("textbox", {
      name: "ai:writing.preview.editLabel",
    });
    expect(m.calls[0]).not.toHaveProperty("tone");
    expect(
      screen.queryByRole("button", { name: "ai:writing.tone.casual" }),
    ).toBeNull();
  });

  it("rates a suggestion once, with its model and never its text", async () => {
    const editor = await mount();
    await runAction(editor, [1, 6], "ai:writing.actions.shorter");
    fireEvent.click(
      await screen.findByRole("button", { name: "ai:writing.feedback.good" }),
    );
    expect(m.feedback).toEqual([
      {
        workspaceId: "ws-1",
        feature: "editor_assist",
        rating: 1,
        provider: "fake",
        model: "fake-fast",
      },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "ai:writing.feedback.thanks",
    );
    expect(
      screen.queryByRole("button", { name: "ai:writing.feedback.bad" }),
    ).toBeNull();
  });
});
