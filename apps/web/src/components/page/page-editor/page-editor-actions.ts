import type { Editor } from "@tiptap/core";
import type { TFunction } from "i18next";

// Actions that live inside a mounted page editor (its hidden file input) but
// are started from outside it, by the formatting toolbar above the canvas.
// Keyed by the editor, so a destroyed editor drops its entry on its own.
const filePickers = new WeakMap<Editor, () => void>();

export function registerFilePicker(editor: Editor, open: () => void) {
  filePickers.set(editor, open);
  return () => {
    if (filePickers.get(editor) === open) filePickers.delete(editor);
  };
}

/** Opens the page editor's file picker; false when it has none. */
export function openFilePicker(editor: Editor): boolean {
  const open = filePickers.get(editor);
  if (!open) return false;
  open();
  return true;
}

/**
 * Asks for a link address and applies it to the selection (an empty
 * answer removes the link), as the bubble menu does.
 */
export function promptForLink(editor: Editor, t: TFunction) {
  if (!editor.isEditable) return;
  const previous = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt(t("tasks:detail.editor.enterUrl"), previous || "");
  if (url === null) return;
  const chain = editor.chain().focus().extendMarkRange("link");
  if (url.trim() === "") chain.unsetLink().run();
  else chain.setLink({ href: url }).run();
}
