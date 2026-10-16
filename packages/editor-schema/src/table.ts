import { Table } from "@tiptap/extension-table";

/**
 * Tables with a `fullWidth` flag: a full-width table spans the whole text
 * column instead of sizing to its columns. Shared by the page editor and
 * the headless schema so the flag survives collaboration and versions;
 * markdown has no place for it and drops it.
 */
export const MargayaTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fullWidth: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-full-width") === "true",
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.fullWidth ? { "data-full-width": "true" } : {},
      },
    };
  },
});
