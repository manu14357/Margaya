import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Sticky } from "@/fetchers/sticky/get-stickies";
import { cn } from "@/lib/cn";
import { moveStickyId } from "@/lib/sticky-cache";
import { getStickyColor } from "@/lib/sticky-colors";
import StickyCard from "./sticky-card";

export const STICKY_PAGE_GRID =
  "grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

function SortableSticky({
  sticky,
  workspaceId,
  canReorder,
}: {
  sticky: Sticky;
  workspaceId: string;
  canReorder: boolean;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sticky.id, disabled: !canReorder });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-40")}
    >
      <StickyCard
        sticky={sticky}
        workspaceId={workspaceId}
        dragHandle={
          canReorder ? (
            <Button
              ref={setActivatorNodeRef}
              variant="ghost"
              size="icon-xs"
              className="cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover/sticky:opacity-100 group-focus-within/sticky:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              {...attributes}
              {...listeners}
              aria-label={t("stickies:reorder")}
              title={t("stickies:reorder")}
            >
              <GripVertical />
            </Button>
          ) : null
        }
      />
    </div>
  );
}

/** A plain preview under the pointer while a sticky is dragged. */
function StickyDragPreview({ sticky }: { sticky: Sticky }) {
  const color = getStickyColor(sticky.color);
  return (
    <div
      className={cn(
        "h-40 overflow-hidden whitespace-pre-wrap rounded-lg border p-3 text-sm text-foreground shadow-lg/5",
        color.cardClassName,
      )}
    >
      {sticky.content.slice(0, 280)}
    </div>
  );
}

type StickyGridProps = {
  stickies: Sticky[];
  workspaceId: string;
  /** Off while a search filters the list: a filtered order means nothing. */
  canReorder: boolean;
  onReorder: (orderedIds: string[]) => void;
};

/** The Stickies page grid; only the footer handle starts a drag. */
export default function StickyGrid({
  stickies,
  workspaceId,
  canReorder,
  onReorder,
}: StickyGridProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const endDrag = () => {
    document.body.classList.remove("margaya-dragging");
    setDraggingId(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    document.body.classList.add("margaya-dragging");
    setDraggingId(String(event.active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    endDrag();
    if (!over || active.id === over.id) return;
    onReorder(
      moveStickyId(
        stickies.map((sticky) => sticky.id),
        String(active.id),
        String(over.id),
      ),
    );
  };

  const dragging = stickies.find((sticky) => sticky.id === draggingId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <SortableContext
        items={stickies.map((sticky) => sticky.id)}
        strategy={rectSortingStrategy}
      >
        <div className={STICKY_PAGE_GRID}>
          {stickies.map((sticky) => (
            <SortableSticky
              key={sticky.id}
              sticky={sticky}
              workspaceId={workspaceId}
              canReorder={canReorder}
            />
          ))}
        </div>
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {dragging ? <StickyDragPreview sticky={dragging} /> : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
