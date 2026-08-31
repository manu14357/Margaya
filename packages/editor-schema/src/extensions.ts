import type { AnyExtension } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Callout } from "./callout.js";
import { MargayaImage } from "./image.js";
import { CUSTOM_NODES, StandaloneInlineTags } from "./nodes.js";

/**
 * The headless page document schema: a superset of the web page editor's
 * schema. StarterKit is configured like the task description editor
 * (headings 1-3, no trailing node); editor-only plugins are left out.
 */
export function createPageExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      trailingNode: false,
      undoRedo: false,
      dropcursor: false,
      gapcursor: false,
      listKeymap: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    MargayaImage,
    Table,
    TableRow,
    TableHeader,
    TableCell,
    Callout,
    ...CUSTOM_NODES,
    StandaloneInlineTags,
  ];
}

let cachedExtensions: AnyExtension[] | null = null;
let cachedSchema: Schema | null = null;

export function pageExtensions(): AnyExtension[] {
  cachedExtensions ??= createPageExtensions();
  return cachedExtensions;
}

/** The ProseMirror schema of a page document (built once). */
export function pageSchema(): Schema {
  cachedSchema ??= getSchema(pageExtensions());
  return cachedSchema;
}
