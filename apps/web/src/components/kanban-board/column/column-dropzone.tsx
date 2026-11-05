import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRenderWindow } from "@/hooks/use-render-window";
import type { ProjectWithTasks } from "@/types/project";
import TaskCard from "../task-card";

type ColumnDropzoneProps = {
  column: ProjectWithTasks["columns"][number];
  disableDragDrop?: boolean;
  /** True while a dragged card would land in this column. */
  onDropTargetChange?: (isTarget: boolean) => void;
  /** Offered from the empty state; omitted without create permission. */
  onAddTask?: () => void;
  /** Cards offer the selection control. */
  selectable?: boolean;
};

/** Where a card from another column would land: a neutral dashed slot. */
function DropPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      data-drop-placeholder
      style={{ height }}
      className="rounded-lg border border-foreground/25 border-dashed bg-muted/40"
    />
  );
}

export function ColumnDropzone({
  column,
  disableDragDrop = false,
  onDropTargetChange,
  onAddTask,
  selectable = true,
}: ColumnDropzoneProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver, active, over } = useDroppable({
    id: column.id,
    data: {
      type: "column",
      column,
    },
  });

  const reduceMotion = useReducedMotion();
  // Large columns mount their cards as they scroll into view.
  const { count, hasMore, sentinelRef } = useRenderWindow(column.tasks.length);
  const visibleTasks = column.tasks.slice(0, count);

  // The board drops a card after the card it is over, or at the end when it
  // is over the column itself; the placeholder shows that spot.
  const overTaskId =
    active && over && !isOver && column.tasks.some((t) => t.id === over.id)
      ? over.id
      : null;
  const isTarget = Boolean(active) && (isOver || overTaskId !== null);
  const isSource = active
    ? column.tasks.some((task) => task.id === active.id)
    : false;
  const showPlaceholder = isTarget && !isSource;
  const placeholderHeight = Math.round(
    active?.rect.current.initial?.height ?? 64,
  );

  useEffect(() => {
    onDropTargetChange?.(isTarget);
  }, [isTarget, onDropTargetChange]);

  const isEmpty = column.tasks.length === 0;

  return (
    <div ref={setNodeRef} className="flex-1 min-h-0">
      <SortableContext
        items={visibleTasks}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-2 flex-col gap-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {visibleTasks.map((task) => (
              <motion.div
                key={task.id}
                className="flex flex-col gap-1.5"
                initial={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }
                }
                animate={
                  reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }
                }
                exit={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }
                }
                transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
              >
                <TaskCard
                  task={task}
                  disableDragDrop={disableDragDrop}
                  selectable={selectable}
                />
                {showPlaceholder && overTaskId === task.id && (
                  <DropPlaceholder height={placeholderHeight} />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {showPlaceholder && isOver && (
            <DropPlaceholder height={placeholderHeight} />
          )}
          {isEmpty && !showPlaceholder && (
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border/80 border-dashed px-3 py-5 text-center">
              <p className="text-muted-foreground text-xs">
                {t("tasks:kanban.emptyTitle")}
              </p>
              {onAddTask && (
                <button
                  type="button"
                  onClick={onAddTask}
                  className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus aria-hidden className="size-3.5" />
                  {t("tasks:kanban.emptyAction")}
                </button>
              )}
            </div>
          )}
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
        </div>
      </SortableContext>
    </div>
  );
}
