import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { useRenderWindow } from "@/hooks/use-render-window";
import type { ProjectWithTasks } from "@/types/project";
import TaskCard from "../task-card";

type ColumnDropzoneProps = {
  column: ProjectWithTasks["columns"][number];
  disableDragDrop?: boolean;
  onIsOverChange?: (isOver: boolean) => void;
};

export function ColumnDropzone({
  column,
  disableDragDrop = false,
  onIsOverChange,
}: ColumnDropzoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: "column",
      column,
    },
  });

  useEffect(() => {
    onIsOverChange?.(isOver);
  }, [isOver, onIsOverChange]);

  const reduceMotion = useReducedMotion();
  // Large columns mount their cards as they scroll into view.
  const { count, hasMore, sentinelRef } = useRenderWindow(column.tasks.length);
  const visibleTasks = column.tasks.slice(0, count);

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
                <TaskCard task={task} disableDragDrop={disableDragDrop} />
              </motion.div>
            ))}
          </AnimatePresence>
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
        </div>
      </SortableContext>
    </div>
  );
}
