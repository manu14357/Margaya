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
import type { TFunction } from "i18next";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageSlashCommands } from "@/components/page/page-editor/page-slash-commands";
import { Callout } from "./callout";
import { EditorImage } from "./editor-image";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const t = ((key: string) => key) as unknown as TFunction;

function Harness({
  content,
  editable = true,
  onEditor,
}: {
  content: string;
  editable?: boolean;
  onEditor: (editor: Editor) => void;
}) {
  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      Markdown,
      EditorImage.configure({
        HTMLAttributes: { class: "margaya-editor-image" },
      }),
      Callout,
    ],
    content,
    contentType: "markdown",
  });
  useEffect(() => {
    if (editor) onEditor(editor);
  }, [editor, onEditor]);
  return <EditorContent editor={editor} />;
}

async function mount(content: string, editable = true) {
  let current: Editor | null = null;
  const view = render(
    <Harness
      content={content}
      editable={editable}
      onEditor={(editor) => {
        current = editor;
      }}
    />,
  );
  await waitFor(() => expect(current).not.toBeNull());
  return { editor: current as unknown as Editor, ...view };
}

const IMAGE = "![A](https://x.test/a.png)";

describe("image attributes", () => {
  it("aligns, resizes and resets the selected image from its toolbar", async () => {
    const { editor } = await mount(IMAGE);
    act(() => {
      editor.commands.setNodeSelection(0);
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "tasks:detail.editor.image.alignCenter",
      }),
    );
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({
      align: "center",
      width: null,
    });
    expect(editor.getMarkdown()).toBe(
      '<img src="https://x.test/a.png" alt="A" data-align="center" />',
    );

    const slider = screen.getByRole("slider", {
      name: "tasks:detail.editor.image.resize",
    });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(editor.getJSON().content?.[0]?.attrs?.width).toBe(10);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(editor.getJSON().content?.[0]?.attrs?.width).toBe(15);
    expect(editor.getMarkdown()).toBe(
      '<img src="https://x.test/a.png" alt="A" width="15%" data-align="center" />',
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "tasks:detail.editor.image.originalSize",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:detail.editor.image.alignLeft",
      }),
    );
    expect(editor.getMarkdown()).toBe(IMAGE);
  });

  it("reads an <img> tag's width and alignment and shows them", async () => {
    const { container } = await mount(
      '<img src="https://x.test/a.png" alt="A" width="40%" data-align="right" />',
    );
    const node = container.querySelector(".margaya-image-node");
    expect(node?.getAttribute("data-align")).toBe("right");
    expect(
      (container.querySelector(".margaya-image-frame") as HTMLElement).style
        .width,
    ).toBe("40%");
  });

  it("offers no toolbar or handles while read-only", async () => {
    const { editor, container } = await mount(IMAGE, false);
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    expect(container.querySelector(".margaya-editor-image")).not.toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});

describe("callout", () => {
  it("renders the markdown variant and switches it with a command", async () => {
    const { editor, container } = await mount("> [!WARNING]\n> Careful");
    const callout = container.querySelector(".margaya-callout");
    expect(callout?.getAttribute("data-variant")).toBe("warning");
    expect(callout?.textContent).toContain("Careful");

    act(() => {
      editor.commands.setTextSelection(3);
      editor.commands.setCalloutVariant("danger");
    });
    expect(editor.getMarkdown()).toBe("> [!CAUTION]\n> Careful");
    await waitFor(() =>
      expect(
        container
          .querySelector(".margaya-callout")
          ?.getAttribute("data-variant"),
      ).toBe("danger"),
    );
  });

  it("is a slash command that wraps the current block", async () => {
    const command = pageSlashCommands(t, {
      onFile: () => {},
      onPageLink: () => {},
    }).find((item) => item.id === "callout");
    expect(command).toMatchObject({
      label: "tasks:detail.editor.slash.commands.callout",
      group: "insert",
    });

    const { editor } = await mount("Intro\n\n/call");
    const start = editor.state.doc.child(0).nodeSize + 1;
    act(() => {
      // The cursor sits after the typed "/call", as when the menu opens.
      editor.commands.setTextSelection(start + 5);
      command?.run(editor, { from: start, to: start + 5 });
    });
    expect(editor.getJSON().content?.[1]).toEqual({
      type: "callout",
      attrs: { variant: "info" },
      content: [{ type: "paragraph" }],
    });
    expect(editor.getMarkdown()).toBe("Intro\n\n> [!NOTE]\n>");
  });
});
