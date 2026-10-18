import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageFormatToolbar, {
  isFormatToolbarAvailable,
} from "./page-format-toolbar";

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

function createEditor(content: string) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      TaskList,
      TaskItem,
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

/** Puts the cursor `offset` characters into the first block. */
function cursorAt(editor: Editor, offset: number) {
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1 + offset),
      ),
    );
  });
}

describe("PageFormatToolbar", () => {
  it("renders the style menu and the mark, list, block and insert groups", () => {
    const editor = createEditor("<p>Hello</p>");
    render(<PageFormatToolbar editor={editor} open />);
    const toolbar = screen.getByRole("toolbar", {
      name: "pages:toolbar.ariaLabel",
    });
    expect(toolbar).toBeInTheDocument();
    for (const name of [
      "pages:toolbar.bold",
      "pages:toolbar.italic",
      "pages:toolbar.underline",
      "pages:toolbar.strike",
      "pages:toolbar.inlineCode",
      "tasks:detail.editor.slash.commands.bullet-list",
      "tasks:detail.editor.slash.commands.ordered-list",
      "tasks:detail.editor.slash.commands.task-list",
      "tasks:detail.editor.slash.commands.blockquote",
      "tasks:detail.editor.slash.commands.code-block",
      "pages:toolbar.link",
      "pages:toolbar.image",
      "pages:editor.slash.commands.divider",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: /pages:toolbar.textStyle/ }),
    ).toHaveAttribute("aria-haspopup", "menu");
  });

  it("presses the toggles that match the selection's marks", () => {
    const editor = createEditor("<p><strong>Bold</strong> plain</p>");
    render(<PageFormatToolbar editor={editor} open />);
    const bold = () =>
      screen.getByRole("button", { name: "pages:toolbar.bold" });
    cursorAt(editor, 2);
    expect(bold()).toHaveAttribute("aria-pressed", "true");
    cursorAt(editor, 7);
    expect(bold()).toHaveAttribute("aria-pressed", "false");
    // Insert actions are plain buttons, not toggles.
    expect(
      screen.getByRole("button", { name: "pages:toolbar.image" }),
    ).not.toHaveAttribute("aria-pressed");
  });

  it("runs commands through the editor", () => {
    const editor = createEditor("<p>Hello</p>");
    render(<PageFormatToolbar editor={editor} open />);
    cursorAt(editor, 1);
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:detail.editor.slash.commands.bullet-list",
      }),
    );
    expect(editor.isActive("bulletList")).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "tasks:detail.editor.slash.commands.bullet-list",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("turns the block into a heading or text from the style menu", async () => {
    const editor = createEditor("<p>Hello</p>");
    render(<PageFormatToolbar editor={editor} open />);
    cursorAt(editor, 1);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /pages:toolbar.textStyle/ }),
      );
    });
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("menuitemradio", {
          name: /pages:editor.slash.commands.heading-2/,
        }),
      );
    });
    expect(editor.isActive("heading", { level: 2 })).toBe(true);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /pages:toolbar.textStyle/ }),
      );
    });
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("menuitemradio", {
          name: /tasks:detail.editor.slash.commands.paragraph/,
        }),
      );
    });
    expect(editor.isActive("paragraph")).toBe(true);
  });

  it("moves focus between controls with the arrow keys", async () => {
    const editor = createEditor("<p>Hello</p>");
    render(<PageFormatToolbar editor={editor} open />);
    const style = screen.getByRole("button", {
      name: /pages:toolbar.textStyle/,
    });
    const bold = screen.getByRole("button", { name: "pages:toolbar.bold" });
    const italic = screen.getByRole("button", { name: "pages:toolbar.italic" });
    // The toolbar moves focus in a microtask after the key.
    const press = async (target: Element, key: string) => {
      await act(async () => {
        fireEvent.keyDown(target, { key });
      });
    };
    act(() => style.focus());
    await press(style, "ArrowRight");
    expect(document.activeElement).toBe(bold);
    await press(bold, "ArrowRight");
    expect(document.activeElement).toBe(italic);
    await press(italic, "ArrowLeft");
    expect(document.activeElement).toBe(bold);
  });

  it("collapses and leaves the tab order when switched off", () => {
    const editor = createEditor("<p>Hello</p>");
    const { container } = render(
      <PageFormatToolbar editor={editor} open={false} />,
    );
    const row = container.querySelector('[data-slot="page-format-toolbar"]');
    expect(row).toHaveAttribute("data-open", "false");
    expect(row).toHaveAttribute("inert");
  });
});

describe("isFormatToolbarAvailable", () => {
  const editable = {
    editable: true,
    isLocked: false,
    isArchived: false,
    isPreviewingVersion: false,
  };

  it("shows the row only on a page that can be edited live", () => {
    expect(isFormatToolbarAvailable(editable)).toBe(true);
    expect(isFormatToolbarAvailable({ ...editable, editable: false })).toBe(
      false,
    );
    expect(isFormatToolbarAvailable({ ...editable, isLocked: true })).toBe(
      false,
    );
    expect(isFormatToolbarAvailable({ ...editable, isArchived: true })).toBe(
      false,
    );
    expect(
      isFormatToolbarAvailable({ ...editable, isPreviewingVersion: true }),
    ).toBe(false);
  });
});
