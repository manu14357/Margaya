import type { Editor } from "@tiptap/core";

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

const linkDialogs = new WeakMap<Editor, () => void>();

/** The page editor registers its link dialog for the toolbar to open. */
export function registerLinkDialog(editor: Editor, open: () => void) {
  linkDialogs.set(editor, open);
  return () => {
    if (linkDialogs.get(editor) === open) linkDialogs.delete(editor);
  };
}

/**
 * Opens the page editor's link dialog for the selection, as the bubble menu
 * does; false when the editor is read-only or has no dialog.
 */
export function promptForLink(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const open = linkDialogs.get(editor);
  if (!open) return false;
  open();
  return true;
}
