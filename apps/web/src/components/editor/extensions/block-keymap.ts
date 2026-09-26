import { Extension } from "@tiptap/core";
import { runBlockCommand } from "../block-commands";

export type BlockKeymapOptions = {
  /** Opens the block menu for the selection's block; false when it can't. */
  onOpenMenu: (() => boolean) | null;
};

/**
 * Alt+Shift+Up/Down move the selection's top-level block; Alt+Shift+M opens
 * the block menu (the keyboard path to Duplicate and Delete).
 */
export const BlockKeymap = Extension.create<BlockKeymapOptions>({
  name: "margayaBlockKeymap",

  addOptions() {
    return { onOpenMenu: null };
  },

  addKeyboardShortcuts() {
    return {
      "Alt-Shift-ArrowUp": ({ editor }) => runBlockCommand(editor, "moveUp"),
      "Alt-Shift-ArrowDown": ({ editor }) =>
        runBlockCommand(editor, "moveDown"),
      "Alt-Shift-m": ({ editor }) =>
        editor.isEditable ? (this.options.onOpenMenu?.() ?? false) : false,
    };
  },
});
