import { type PointerEvent, type RefObject, useCallback } from "react";

// Below this a press on the handle is a click, which opens the picker.
const CLICK_MOVE_THRESHOLD_PX = 4;
const TARGET_ATTRIBUTE = "data-gantt-link-target";
const LINE_HIT_ATTRIBUTE = "data-gantt-line-hit";

/**
 * The row of the dated task under a point, if any. A line's click area lies
 * over the rows, along the very middle of the row it arrives at, so it must
 * not hide that row from a drag.
 */
function ganttRowAt(x: number, y: number): HTMLElement | null {
  const under = document
    .elementsFromPoint?.(x, y)
    .find((element) => !element.hasAttribute(LINE_HIT_ATTRIBUTE));
  return under?.closest<HTMLElement>("[data-gantt-row]") ?? null;
}

type Options = {
  /** The preview: an SVG over the timeline, holding one `path`. */
  previewRef: RefObject<SVGSVGElement | null>;
  /** Let go on another task's row. */
  onLink: (sourceTaskId: string, targetTaskId: string) => void;
  /** Pressed without moving: a tap, or a click that didn't mean to draw. */
  onClick: (sourceTaskId: string) => void;
};

/**
 * Drawing a link from a bar's handle to another task's row. The preview and
 * the highlighted row are written straight to the DOM: a pointer move must
 * not re-render every row of a big project.
 */
export function useGanttLinkDrag({ previewRef, onLink, onClick }: Options) {
  return useCallback(
    (event: PointerEvent<HTMLElement>, sourceTaskId: string) => {
      if (event.button !== 0) return;
      const preview = previewRef.current;
      const path = preview?.querySelector("path");
      if (!preview || !path) return;
      event.preventDefault();
      event.stopPropagation();

      // In the preview's own coordinates, which scroll with the rows, so the
      // line stays on the bar if the chart scrolls during the drag.
      const toLocal = (clientX: number, clientY: number) => {
        const origin = preview.getBoundingClientRect();
        return { x: clientX - origin.left, y: clientY - origin.top };
      };
      const handle = event.currentTarget.getBoundingClientRect();
      const from = toLocal(
        handle.left + handle.width / 2,
        handle.top + handle.height / 2,
      );
      const originX = event.clientX;
      const originY = event.clientY;
      let dragging = false;
      let targetRow: HTMLElement | null = null;

      const setTargetRow = (row: HTMLElement | null) => {
        if (row === targetRow) return;
        targetRow?.removeAttribute(TARGET_ATTRIBUTE);
        row?.setAttribute(TARGET_ATTRIBUTE, "");
        targetRow = row;
      };

      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKeyDown);
        setTargetRow(null);
        preview.style.visibility = "hidden";
        path.removeAttribute("d");
      };

      const onMove = (move: globalThis.PointerEvent) => {
        if (
          !dragging &&
          Math.hypot(move.clientX - originX, move.clientY - originY) <
            CLICK_MOVE_THRESHOLD_PX
        ) {
          return;
        }
        dragging = true;
        preview.style.visibility = "visible";
        const to = toLocal(move.clientX, move.clientY);
        path.setAttribute("d", `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
        const row = ganttRowAt(move.clientX, move.clientY);
        setTargetRow(row?.dataset.ganttRow === sourceTaskId ? null : row);
      };

      const onUp = () => {
        const targetTaskId = targetRow?.dataset.ganttRow;
        const wasDragging = dragging;
        finish();
        if (!wasDragging) onClick(sourceTaskId);
        else if (targetTaskId) onLink(sourceTaskId, targetTaskId);
      };

      const onCancel = () => finish();

      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") finish();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKeyDown);
    },
    [previewRef, onLink, onClick],
  );
}
