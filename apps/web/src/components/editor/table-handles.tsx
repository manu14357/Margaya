import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { GripHorizontal, GripVertical, Plus } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  hasOnlySimpleCells,
  moveTableColumn,
  moveTableRow,
  tableAtSelection,
} from "@/components/editor/extensions/table-tools";
import { cn } from "@/lib/cn";

type Band = { start: number; size: number };

type Layout = {
  pos: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  rows: Band[];
  columns: Band[];
  movable: boolean;
};

type Drag = { kind: "row" | "column"; index: number } | null;

const GUTTER = 18;

/** Where the table around the selection is drawn, in viewport pixels. */
function measure(editor: Editor): Layout | null {
  if (!editor.isEditable) return null;
  const found = tableAtSelection(editor.state);
  if (!found) return null;
  const dom = editor.view.nodeDOM(found.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const table = dom.tagName === "TABLE" ? dom : dom.querySelector("table");
  if (!table) return null;
  const rowElements = Array.from(table.querySelectorAll("tr")).filter(
    (row) => row.closest("table") === table,
  );
  const box = table.getBoundingClientRect();
  const rows = rowElements.map((row) => {
    const rect = row.getBoundingClientRect();
    return { start: rect.top, size: rect.height };
  });
  const columns = Array.from(rowElements[0]?.children ?? []).map((cell) => {
    const rect = cell.getBoundingClientRect();
    return { start: rect.left, size: rect.width };
  });
  return {
    pos: found.pos,
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    rows,
    columns,
    movable: hasOnlySimpleCells(found.node),
  };
}

/** Puts the cursor in a cell of the table at `tablePos`. */
function selectCell(
  editor: Editor,
  tablePos: number,
  row: number,
  column: number,
) {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table) return false;
  let target: number | null = null;
  table.forEach((rowNode, rowOffset, rowIndex) => {
    if (rowIndex !== row) return;
    rowNode.forEach((_cell, cellOffset, cellIndex) => {
      if (cellIndex === column)
        target = tablePos + 1 + rowOffset + 1 + cellOffset;
    });
  });
  if (target === null) return false;
  const { tr } = editor.state;
  tr.setSelection(TextSelection.near(tr.doc.resolve((target as number) + 1)));
  editor.view.dispatch(tr);
  return true;
}

/**
 * Handles around the table that holds the cursor: grips to drag (or, when
 * focused, arrow-key) a row or column to a new place, and "+" buttons on
 * the lines between rows and columns. Only the active table gets them.
 */
export default function TableHandles({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<Layout | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<Drag>(null);
  // Shown only while the editor or a handle has focus, so a dialog opened
  // on top never shows stray handles.
  const [active, setActive] = useState(false);

  useEffect(() => {
    const check = () => {
      const focused = document.activeElement;
      setActive(
        Boolean(focused) &&
          (editor.view.dom.contains(focused) ||
            Boolean(focused?.closest("[data-table-handles]"))),
      );
    };
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    check();
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, [editor]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLayout(measure(editor)));
    };
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("selectionUpdate", update);
      editor.off("update", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  if (!layout || !active) return null;
  const { pos } = layout;

  const move = (kind: "row" | "column", from: number, to: number) => {
    const moved =
      kind === "row"
        ? moveTableRow(editor, pos, from, to)
        : moveTableColumn(editor, pos, from, to);
    if (moved) editor.view.focus();
    return moved;
  };

  const insertRow = (after: number) => {
    const row = Math.max(after, 0);
    if (!selectCell(editor, pos, row, 0)) return;
    if (after < 0) editor.chain().focus().addRowBefore().run();
    else editor.chain().focus().addRowAfter().run();
  };

  const insertColumn = (after: number) => {
    const column = Math.max(after, 0);
    if (!selectCell(editor, pos, 0, column)) return;
    if (after < 0) editor.chain().focus().addColumnBefore().run();
    else editor.chain().focus().addColumnAfter().run();
  };

  const onGripKey =
    (kind: "row" | "column", index: number) =>
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const step =
        kind === "row"
          ? { ArrowUp: -1, ArrowDown: 1 }[event.key]
          : { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      move(kind, index, index + step);
    };

  const grip = (kind: "row" | "column", index: number, style: object) => {
    const isTarget =
      drag !== null &&
      over?.kind === kind &&
      over.index === index &&
      drag.index !== index;
    return (
      <button
        key={`${kind}-${index}`}
        type="button"
        draggable={layout.movable}
        disabled={!layout.movable}
        aria-label={t(
          kind === "row"
            ? "tasks:editor.table.dragRow"
            : "tasks:editor.table.dragColumn",
          { index: index + 1 },
        )}
        title={t(
          kind === "row"
            ? "tasks:editor.table.dragRowHint"
            : "tasks:editor.table.dragColumnHint",
        )}
        className={cn(
          "margaya-table-handle fixed z-[60] flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
          layout.movable && "cursor-grab",
          isTarget && "bg-accent text-accent-foreground",
        )}
        style={style}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={onGripKey(kind, index)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", "");
          setDrag({ kind, index });
        }}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
        onDragOver={(event) => {
          if (drag?.kind !== kind) return;
          event.preventDefault();
          setOver({ kind, index });
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (drag?.kind === kind) move(kind, drag.index, index);
          setDrag(null);
          setOver(null);
        }}
      >
        {kind === "row" ? (
          <GripVertical className="size-3" aria-hidden />
        ) : (
          <GripHorizontal className="size-3" aria-hidden />
        )}
      </button>
    );
  };

  const plus = (kind: "row" | "column", after: number, style: object) => (
    <button
      key={`plus-${kind}-${after}`}
      type="button"
      aria-label={t(
        kind === "row"
          ? "tasks:editor.table.insertRowHere"
          : "tasks:editor.table.insertColumnHere",
      )}
      title={t(
        kind === "row"
          ? "tasks:editor.table.insertRowHere"
          : "tasks:editor.table.insertColumnHere",
      )}
      className="margaya-table-plus fixed z-[60] flex size-3.5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => (kind === "row" ? insertRow(after) : insertColumn(after))}
    >
      <Plus className="size-2.5" aria-hidden />
    </button>
  );

  const rowGripLeft = layout.left - GUTTER;
  const columnGripTop = layout.top - GUTTER;

  return createPortal(
    <div className="margaya-table-handles" data-table-handles>
      {layout.rows.map((row, index) =>
        grip("row", index, {
          left: rowGripLeft,
          top: row.start + row.size / 2 - 8,
        }),
      )}
      {layout.columns.map((column, index) =>
        grip("column", index, {
          left: column.start + column.size / 2 - 8,
          top: columnGripTop,
        }),
      )}
      {layout.rows.map((row, index) =>
        plus("row", index, {
          left: rowGripLeft + 1,
          top: row.start + row.size - 7,
        }),
      )}
      {layout.columns.map((column, index) =>
        plus("column", index, {
          left: column.start + column.size - 7,
          top: columnGripTop + 1,
        }),
      )}
    </div>,
    document.body,
  );
}
