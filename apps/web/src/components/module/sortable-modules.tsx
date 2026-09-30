import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useReorderModules } from "@/hooks/mutations/module/use-reorder-modules";
import { cn } from "@/lib/cn";
import type { ModuleLayout } from "@/lib/module/display";
import { toast } from "@/lib/toast";
import type { Module } from "@/types/module";

type SortableItemProps = {
  id: string;
  children: (handle: ReactNode) => ReactNode;
};

function SortableItem({ id, children }: SortableItemProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id,
    // The drop already moves the item; animating the index change too
    // replays the same move from a stale offset.
    animateLayoutChanges: () => false,
    transition: { duration: 200, easing: "var(--ease-out)" },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isSorting ? transition : undefined,
  };

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={t("modules:row.dragHandle")}
      title={t("modules:row.dragHandle")}
      className="relative z-10 -ml-1 inline-flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "relative z-20 shadow-md")}
    >
      {children(handle)}
    </div>
  );
}

type SortableModulesProps = {
  projectId: string;
  /** The modules as shown, in manual order. */
  modules: Module[];
  layout: ModuleLayout;
  renderModule: (module: Module, handle: ReactNode) => ReactNode;
};

/**
 * Drag-to-reorder for the manual order, in the list or the gallery. Like
 * the projects page, the dropped order is held in state until the server's
 * order agrees, so rows never jump back mid-save.
 */
export default function SortableModules({
  projectId,
  modules,
  layout,
  renderModule,
}: SortableModulesProps) {
  const { t } = useTranslation();
  const reorder = useReorderModules();
  const [droppedOrder, setDroppedOrder] = useState<string[] | null>(null);

  const ordered = useMemo(() => {
    if (!droppedOrder) return modules;
    const rank = new Map(droppedOrder.map((id, index) => [id, index]));
    return [...modules].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [modules, droppedOrder]);

  // Released once the server agrees, or a reorder made elsewhere stays pinned.
  useEffect(() => {
    if (!droppedOrder) return;
    if (modules.map((module) => module.id).join() === droppedOrder.join()) {
      setDroppedOrder(null);
    }
  }, [modules, droppedOrder]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    document.body.classList.remove("margaya-dragging");
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((module) => module.id === active.id);
    const to = ordered.findIndex((module) => module.id === over.id);
    if (from === -1 || to === -1) return;

    const moduleIds = arrayMove(ordered, from, to).map((module) => module.id);
    setDroppedOrder(moduleIds);
    reorder.mutate(
      { projectId, moduleIds },
      {
        onError: () => {
          setDroppedOrder(null);
          toast.error(t("modules:toast.reorderError"));
        },
      },
    );
  };

  const items = ordered.map((module) => (
    <SortableItem key={module.id} id={module.id}>
      {(handle) => renderModule(module, handle)}
    </SortableItem>
  ));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]}
      onDragStart={() => document.body.classList.add("margaya-dragging")}
      onDragEnd={handleDragEnd}
      onDragCancel={() => document.body.classList.remove("margaya-dragging")}
    >
      <SortableContext
        items={ordered.map((module) => module.id)}
        strategy={
          layout === "list" ? verticalListSortingStrategy : rectSortingStrategy
        }
      >
        {layout === "list" ? (
          <div className="divide-y divide-border/50">{items}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {items}
          </div>
        )}
      </SortableContext>
    </DndContext>
  );
}
