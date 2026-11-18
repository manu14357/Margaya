import { FileTypeIcon } from "@margaya/file-preview";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { FileEntry } from "../lib/files-api";
import {
  formatDate,
  formatSize,
  gridColumns,
  moveSelection,
  type ViewMode,
  visibleRange,
} from "../lib/files-model";
import { useT } from "../lib/i18n";

export const ROW_HEIGHT = 32;
export const CELL_WIDTH = 116;
export const CELL_HEIGHT = 112;
/** How far the pointer moves with the button down before a file drag starts. */
const DRAG_DISTANCE = 6;

export function FolderIcon({ size }: { size: number }) {
  return (
    <svg
      className="files-folder-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6a2 2 0 0 1 1.5.7l1.2 1.3h6.7A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
    </svg>
  );
}

function EntryIcon({ entry, size }: { entry: FileEntry; size: number }) {
  return entry.kind === "folder" ? (
    <FolderIcon size={size} />
  ) : (
    <FileTypeIcon name={entry.name} size={size} />
  );
}

function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}

/**
 * The folder's entries as a virtualized list or grid: only the rows in
 * view are in the DOM, so folders with thousands of entries stay quick.
 * One `listbox` with `aria-activedescendant`; arrows, Home/End and
 * PageUp/PageDown move the selection, Enter opens.
 */
export function FilesEntries({
  entries,
  view,
  selected,
  label,
  showFolder,
  listRef,
  onSelect,
  onOpen,
  onMenu,
  onKey,
  onDragOut,
}: {
  entries: FileEntry[];
  view: ViewMode;
  selected: number;
  label: string;
  /** Search results and Recent show where each file is. */
  showFolder: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (index: number) => void;
  onOpen: (entry: FileEntry) => void;
  onMenu: (entry: FileEntry, x: number, y: number) => void;
  /** Keys the list doesn't handle itself (Enter, Backspace, ...). */
  onKey: (event: KeyboardEvent<HTMLDivElement>) => void;
  onDragOut: (entry: FileEntry) => void;
}) {
  const t = useT();
  const id = useId();
  const box = useBox(listRef);
  const [scrollTop, setScrollTop] = useState(0);
  const press = useRef<{ x: number; y: number; entry: FileEntry } | null>(null);
  const locale = document.documentElement.lang || undefined;

  const columns = view === "grid" ? gridColumns(box.width - 16, CELL_WIDTH) : 1;
  const rowHeight = view === "grid" ? CELL_HEIGHT : ROW_HEIGHT;
  const rows = Math.ceil(entries.length / columns);
  const [firstRow, lastRow] = visibleRange(
    scrollTop,
    box.height,
    rowHeight,
    rows,
  );

  // Keep the selected item in view as the keyboard moves it.
  useEffect(() => {
    const list = listRef.current;
    if (!list || selected < 0) return;
    const top = Math.floor(selected / columns) * rowHeight;
    const header = view === "list" ? ROW_HEIGHT : 0;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + rowHeight + header > list.scrollTop + list.clientHeight)
      list.scrollTop = top + rowHeight + header - list.clientHeight;
  }, [selected, columns, rowHeight, listRef, view]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves = [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageDown",
      "PageUp",
    ];
    if (moves.includes(event.key) && !event.altKey) {
      event.preventDefault();
      onSelect(moveSelection(selected, event.key, entries.length, columns));
      return;
    }
    onKey(event);
  };

  const onPointerDown = (event: PointerEvent, entry: FileEntry) => {
    if (event.button !== 0 || entry.kind !== "file") return;
    press.current = { x: event.clientX, y: event.clientY, entry };
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = press.current;
    if (!start || (event.buttons & 1) === 0) {
      press.current = null;
      return;
    }
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >=
      DRAG_DISTANCE
    ) {
      press.current = null;
      onDragOut(start.entry);
    }
  };

  const optionId = (index: number) => `${id}-option-${index}`;
  const items: ReactNode[] = [];
  for (let row = firstRow; row < lastRow; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const entry = entries[index];
      if (!entry) break;
      const isSelected = index === selected;
      const common = {
        id: optionId(index),
        role: "option",
        "aria-selected": isSelected,
        className: `files-entry ${view} ${isSelected ? "selected" : ""} ${
          entry.hidden ? "hidden-item" : ""
        }`,
        title:
          entry.kind === "file"
            ? `${entry.path}\n${t("files.dragHint")}`
            : entry.path,
        onClick: () => onSelect(index),
        onDoubleClick: () => onOpen(entry),
        onContextMenu: (event: MouseEvent) => {
          event.preventDefault();
          onSelect(index);
          onMenu(entry, event.clientX, event.clientY);
        },
        onPointerDown: (event: PointerEvent) => onPointerDown(event, entry),
        onPointerMove,
        onPointerUp: () => {
          press.current = null;
        },
      } as const;
      if (view === "grid") {
        items.push(
          <div
            key={entry.path}
            {...common}
            style={{
              top: row * CELL_HEIGHT,
              left: column * CELL_WIDTH,
              width: CELL_WIDTH,
              height: CELL_HEIGHT,
            }}
          >
            <EntryIcon entry={entry} size={48} />
            <span className="files-entry-name">{entry.name}</span>
          </div>,
        );
      } else {
        items.push(
          <div
            key={entry.path}
            {...common}
            style={{ top: row * ROW_HEIGHT, height: ROW_HEIGHT }}
          >
            <span className="files-cell name">
              <EntryIcon entry={entry} size={20} />
              <span className="files-entry-name">{entry.name}</span>
            </span>
            {showFolder ? (
              <span className="files-cell folder">{entry.folder ?? ""}</span>
            ) : null}
            <span className="files-cell modified">
              {formatDate(entry.modified, locale)}
            </span>
            <span className="files-cell size">
              {entry.kind === "file" ? formatSize(entry.size, locale) : ""}
            </span>
          </div>,
        );
      }
    }
  }

  return (
    <div
      ref={listRef}
      className={`files-entries ${view}`}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={selected >= 0 ? optionId(selected) : undefined}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      {view === "list" ? (
        <div className="files-header" aria-hidden="true">
          <span className="files-cell name">{t("files.columnName")}</span>
          {showFolder ? (
            <span className="files-cell folder">{t("files.columnFolder")}</span>
          ) : null}
          <span className="files-cell modified">
            {t("files.columnModified")}
          </span>
          <span className="files-cell size">{t("files.columnSize")}</span>
        </div>
      ) : null}
      <div className="files-spacer" style={{ height: rows * rowHeight }}>
        {items}
      </div>
    </div>
  );
}
