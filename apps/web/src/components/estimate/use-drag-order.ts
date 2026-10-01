import type { DragEvent } from "react";
import { useEffect, useRef, useState } from "react";

function moveId(ids: readonly string[], fromId: string, toId: string) {
  const next = ids.filter((id) => id !== fromId);
  const target = ids.indexOf(toId);
  next.splice(target, 0, fromId);
  return next;
}

/**
 * Drag-to-reorder for a short list (category values), with native HTML5
 * drag like the column editor. The order changes locally while dragging and
 * `onReorder` runs once, on drop, when it actually changed.
 */
export function useDragOrder(
  ids: readonly string[],
  onReorder: (ids: string[]) => void,
) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);

  useEffect(() => () => previewRef.current?.remove(), []);

  const start = (event: DragEvent<HTMLElement>, id: string) => {
    setDraggedId(id);
    setOrder([...ids]);
    previewRef.current?.remove();

    // An isolated clone, so the drag image shows only this row.
    const source = event.currentTarget;
    const rect = source.getBoundingClientRect();
    const preview = source.cloneNode(true) as HTMLElement;
    preview.setAttribute("aria-hidden", "true");
    preview.inert = true;
    Object.assign(preview.style, {
      position: "fixed",
      top: "-10000px",
      left: "-10000px",
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      boxSizing: "border-box",
      pointerEvents: "none",
    });
    document.body.appendChild(preview);
    previewRef.current = preview;

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.setDragImage(
      preview,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  };

  const over = (event: DragEvent<HTMLElement>, id: string) => {
    if (!draggedId) return;
    event.preventDefault();
    if (draggedId === id) return;
    setOrder((current) => moveId(current ?? [...ids], draggedId, id));
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    if (draggedId) event.preventDefault();
  };

  // A drag dropped outside the list (or cancelled with Escape) ends with
  // dropEffect "none" and keeps the old order.
  const end = (event: DragEvent<HTMLElement>) => {
    previewRef.current?.remove();
    previewRef.current = null;
    const dropped = event.dataTransfer.dropEffect !== "none";
    if (dropped && order?.some((id, index) => id !== ids[index])) {
      onReorder(order);
    }
    setOrder(null);
    setDraggedId(null);
  };

  return { order: order ?? ids, draggedId, start, over, drop, end };
}
