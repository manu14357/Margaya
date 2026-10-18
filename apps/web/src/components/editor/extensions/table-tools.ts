import { MargayaTable } from "@margaya/editor-schema";
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Table power tools: move rows and columns (bubble menu, and drag handles
// that also take arrow keys), and a full-width flag shown through a class on the
// table's wrapper. Merged cells make a move ambiguous, so such tables are
// left as they are.

/** True when no cell spans more than one row or column. */
export function hasOnlySimpleCells(table: PMNode): boolean {
  let simple = true;
  table.forEach((row) => {
    row.forEach((cell) => {
      if ((cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1) {
        simple = false;
      }
    });
  });
  return simple;
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

function childrenOf(node: PMNode): PMNode[] {
  const children: PMNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return children;
}

/** The table with row `from` moved to index `to`, or null when it can't. */
export function reorderTableRows(
  table: PMNode,
  from: number,
  to: number,
): PMNode | null {
  const rows = childrenOf(table);
  if (from === to || !rows[from] || to < 0 || to >= rows.length) return null;
  if (!hasOnlySimpleCells(table)) return null;
  return table.copy(Fragment.fromArray(moveItem(rows, from, to)));
}

/** The table with column `from` moved to index `to`, or null when it can't. */
export function reorderTableColumns(
  table: PMNode,
  from: number,
  to: number,
): PMNode | null {
  if (from === to || !hasOnlySimpleCells(table)) return null;
  const rows = childrenOf(table);
  const width = rows[0]?.childCount ?? 0;
  if (from < 0 || from >= width || to < 0 || to >= width) return null;
  if (rows.some((row) => row.childCount !== width)) return null;
  return table.copy(
    Fragment.fromArray(
      rows.map((row) =>
        row.copy(Fragment.fromArray(moveItem(childrenOf(row), from, to))),
      ),
    ),
  );
}

export type TableAtSelection = {
  node: PMNode;
  pos: number;
  row: number;
  column: number;
};

/** The table around the selection and the cell's row and column. */
export function tableAtSelection(state: EditorState): TableAtSelection | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== "table") continue;
    if ($from.depth < depth + 2) return null;
    return {
      node,
      pos: $from.before(depth),
      row: $from.index(depth),
      column: $from.index(depth + 1),
    };
  }
  return null;
}

/** Replaces the table at `pos` and keeps the cursor in the moved cell. */
function replaceTable(
  editor: Editor,
  pos: number,
  next: PMNode,
  cell: { row: number; column: number },
) {
  const { state, view } = editor;
  const current = state.doc.nodeAt(pos);
  if (!current) return false;
  const tr = state.tr.replaceWith(pos, pos + current.nodeSize, next);
  let cellPos = pos + 1;
  next.forEach((row, rowOffset, rowIndex) => {
    if (rowIndex !== cell.row) return;
    row.forEach((_cellNode, cellOffset, cellIndex) => {
      if (cellIndex === cell.column)
        cellPos = pos + 1 + rowOffset + 1 + cellOffset;
    });
  });
  const $cell = tr.doc.resolve(Math.min(cellPos + 2, tr.doc.content.size));
  try {
    tr.setSelection(TextSelection.near($cell));
  } catch {
    // The default mapping keeps a valid selection.
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Moves a row of the table at `tablePos`; true when it moved. */
export function moveTableRow(
  editor: Editor,
  tablePos: number,
  from: number,
  to: number,
): boolean {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const next = reorderTableRows(table, from, to);
  if (!next) return false;
  const column = tableAtSelection(editor.state)?.column ?? 0;
  return replaceTable(editor, tablePos, next, { row: to, column });
}

/** Moves a column of the table at `tablePos`; true when it moved. */
export function moveTableColumn(
  editor: Editor,
  tablePos: number,
  from: number,
  to: number,
): boolean {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const next = reorderTableColumns(table, from, to);
  if (!next) return false;
  const row = tableAtSelection(editor.state)?.row ?? 0;
  return replaceTable(editor, tablePos, next, { row, column: to });
}

/** Moves the selection's row or column one step; true when it moved. */
export function moveSelectionLine(
  editor: Editor,
  direction: "up" | "down" | "left" | "right",
): boolean {
  const found = tableAtSelection(editor.state);
  if (!found) return false;
  if (direction === "up" || direction === "down") {
    const to = found.row + (direction === "up" ? -1 : 1);
    return moveTableRow(editor, found.pos, found.row, to);
  }
  const to = found.column + (direction === "left" ? -1 : 1);
  return moveTableColumn(editor, found.pos, found.column, to);
}

/** Flips the full-width flag of the selection's table. */
export function toggleTableFullWidth(editor: Editor): boolean {
  const found = tableAtSelection(editor.state);
  if (!found) return false;
  const { state, view } = editor;
  view.dispatch(
    state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.node.attrs,
      fullWidth: !found.node.attrs.fullWidth,
    }),
  );
  return true;
}

const fullWidthKey = new PluginKey("margaya-table-full-width");

/** `is-full-width` on full-width tables (their node view ignores attrs). */
function fullWidthPlugin() {
  return new Plugin({
    key: fullWidthKey,
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === "table") {
            if (node.attrs.fullWidth) {
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: "is-full-width",
                }),
              );
            }
            return false;
          }
          return node.isBlock;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/** The editors' table: the shared schema plus moves and full width. */
export const MargayaEditorTable = MargayaTable.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), fullWidthPlugin()];
  },
});
