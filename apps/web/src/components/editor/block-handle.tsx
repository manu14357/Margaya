import type { Editor, EditorEvents } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  ArrowDown,
  ArrowUp,
  CopyPlus,
  GripVertical,
  Trash2,
} from "lucide-react";
import type { DragEvent, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
} from "@/components/ui/menu";
import {
  type BlockCommand,
  runBlockCommand,
  topBlockAt,
} from "./block-commands";

const HANDLE_SIZE = 24;

type Shown = { pos: number; top: number; left: number };

type BlockHandleProps = {
  editor: Editor | null;
  /** The positioned element the handle is placed in. */
  shellRef: RefObject<HTMLElement | null>;
  editable: boolean;
  /** Filled with the keyboard entry point (Alt+Shift+M). */
  openMenuRef: { current: () => boolean };
};

/**
 * The handle left of a top-level block: shown on hover, and for the block
 * holding the cursor while the editor has focus. Drag it to move the block,
 * click it for Move up, Move down, Duplicate and Delete. Never shown while
 * the editor is read-only.
 */
export default function BlockHandle({
  editor,
  shellRef,
  editable,
  openMenuRef,
}: BlockHandleProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<Shown | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  const ranCommandRef = useRef(false);
  const active = Boolean(editor && editable);

  const measure = useCallback(
    (pos: number): Shown | null => {
      const shell = shellRef.current;
      if (!editor || editor.isDestroyed || !shell) return null;
      const block = topBlockAt(editor.state.doc, pos);
      if (!block) return null;
      const dom = editor.view.nodeDOM(block.pos);
      if (!(dom instanceof HTMLElement)) return null;
      const rect = dom.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const content = editor.view.dom.getBoundingClientRect();
      const lineHeight =
        Number.parseFloat(getComputedStyle(dom).lineHeight) || HANDLE_SIZE;
      return {
        pos: block.pos,
        top:
          rect.top -
          shellRect.top +
          Math.max(0, (Math.min(lineHeight, rect.height) - HANDLE_SIZE) / 2),
        left: content.left - shellRect.left - HANDLE_SIZE - 6,
      };
    },
    [editor, shellRef],
  );

  // Hover: the block under the pointer, measured once per frame.
  useEffect(() => {
    const shell = shellRef.current;
    if (!active || !editor || !shell) return;
    let frame = 0;
    let lastY = 0;
    let lastX = 0;
    const update = () => {
      frame = 0;
      if (menuOpenRef.current || editor.isDestroyed) return;
      const content = editor.view.dom.getBoundingClientRect();
      if (lastY < content.top || lastY > content.bottom) return;
      const hit = editor.view.posAtCoords({
        left: Math.min(Math.max(lastX, content.left + 2), content.right - 2),
        top: lastY,
      });
      if (!hit) return;
      const next = measure(hit.inside >= 0 ? hit.inside : hit.pos);
      if (next) setShown(next);
    };
    const onMove = (event: MouseEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onLeave = () => {
      const handleFocused = handleRef.current?.contains(document.activeElement);
      if (menuOpenRef.current || handleFocused || editor.isFocused) return;
      setShown(null);
    };
    shell.addEventListener("mousemove", onMove);
    shell.addEventListener("mouseleave", onLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      shell.removeEventListener("mousemove", onMove);
      shell.removeEventListener("mouseleave", onLeave);
    };
  }, [active, editor, measure, shellRef]);

  // Focus: the block holding the cursor; edits keep the shown block in place.
  useEffect(() => {
    if (!active || !editor) return;
    const followSelection = () => {
      if (!editor.isFocused || menuOpenRef.current) return;
      setShown(measure(editor.state.selection.from));
    };
    const onTransaction = ({ transaction }: EditorEvents["transaction"]) => {
      const current = shownRef.current;
      if (!transaction.docChanged || !current) return;
      setShown(measure(transaction.mapping.map(current.pos)));
    };
    const onBlur = ({ event }: EditorEvents["blur"]) => {
      const next = event.relatedTarget;
      if (next instanceof Node && handleRef.current?.contains(next)) return;
      if (!menuOpenRef.current) setShown(null);
    };
    editor.on("focus", followSelection);
    editor.on("selectionUpdate", followSelection);
    editor.on("transaction", onTransaction);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", followSelection);
      editor.off("selectionUpdate", followSelection);
      editor.off("transaction", onTransaction);
      editor.off("blur", onBlur);
    };
  }, [active, editor, measure]);

  useEffect(() => {
    if (!active) {
      setShown(null);
      setMenuOpen(false);
    }
  }, [active]);

  // Alt+Shift+M: the menu for the cursor's block.
  useEffect(() => {
    openMenuRef.current = () => {
      if (!active || !editor) return false;
      const next = measure(editor.state.selection.from);
      if (!next) return false;
      setShown(next);
      setMenuOpen(true);
      return true;
    };
    return () => {
      openMenuRef.current = () => false;
    };
  }, [active, editor, measure, openMenuRef]);

  const run = (command: BlockCommand) => {
    const current = shownRef.current;
    if (!editor || !current) return;
    ranCommandRef.current = true;
    setMenuOpen(false);
    runBlockCommand(editor, command, current.pos);
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    const current = shownRef.current;
    if (!editor || !current || !event.dataTransfer) return;
    const { view } = editor;
    const block = topBlockAt(view.state.doc, current.pos);
    if (!block) return;
    const selection = NodeSelection.create(view.state.doc, block.pos);
    view.dispatch(view.state.tr.setSelection(selection));
    const slice = selection.content();
    const { dom, text } = view.serializeForClipboard(slice);
    event.dataTransfer.clearData();
    event.dataTransfer.setData("text/html", dom.innerHTML);
    event.dataTransfer.setData("text/plain", text);
    event.dataTransfer.effectAllowed = "copyMove";
    const blockDom = view.nodeDOM(block.pos);
    if (blockDom instanceof HTMLElement) {
      event.dataTransfer.setDragImage(blockDom, 0, 0);
    }
    // ProseMirror's own drop handling then moves the block (one transaction).
    // `node` lets it find the block again after a remote edit moved it.
    view.dragging = {
      slice,
      move: true,
      node: selection,
    } as typeof view.dragging;
  };

  const onDragEnd = () => {
    if (!editor) return;
    const { view } = editor;
    window.setTimeout(() => {
      if (view.dragging) view.dragging = null;
    }, 50);
  };

  if (!active || !editor) return null;

  const block = shown ? topBlockAt(editor.state.doc, shown.pos) : null;
  const isFirst = !block || block.index === 0;
  const isLast = !block || block.index >= editor.state.doc.childCount - 1;

  return (
    <>
      {shown && (
        <button
          ref={handleRef}
          type="button"
          className="margaya-block-handle"
          style={{ top: shown.top, left: shown.left }}
          draggable
          aria-label={t("tasks:detail.editor.block.handle")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={t("tasks:detail.editor.block.handle")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setMenuOpen((open) => !open)}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (menuOpenRef.current) return;
            if (next instanceof Node && editor.view.dom.contains(next)) return;
            setShown(null);
          }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      <Menu
        open={menuOpen && Boolean(shown)}
        onOpenChange={(open) => setMenuOpen(open)}
      >
        <MenuPopup
          anchor={handleRef}
          side="bottom"
          align="start"
          className="w-52"
          aria-label={t("tasks:detail.editor.block.menu")}
          finalFocus={() => {
            const focusEditor = ranCommandRef.current;
            ranCommandRef.current = false;
            return focusEditor ? editor.view.dom : handleRef.current;
          }}
        >
          <MenuItem disabled={isFirst} onClick={() => run("moveUp")}>
            <ArrowUp />
            {t("tasks:detail.editor.block.moveUp")}
            <MenuShortcut>Alt Shift ↑</MenuShortcut>
          </MenuItem>
          <MenuItem disabled={isLast} onClick={() => run("moveDown")}>
            <ArrowDown />
            {t("tasks:detail.editor.block.moveDown")}
            <MenuShortcut>Alt Shift ↓</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run("duplicate")}>
            <CopyPlus />
            {t("tasks:detail.editor.block.duplicate")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => run("delete")}>
            <Trash2 />
            {t("tasks:detail.editor.block.delete")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </>
  );
}
