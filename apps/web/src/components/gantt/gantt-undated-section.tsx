import { useDraggable } from "@dnd-kit/core";
import { CalendarPlus, GripVertical } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getStatusLabel } from "@/lib/i18n/domain";
import type Task from "@/types/task";

export type UndatedDragData = { kind: "undated-task"; taskId: string };

type GanttUndatedSectionProps = {
  tasks: Task[];
  projectSlug?: string;
  /** Width of the left list, as a CSS length. */
  railWidth: string;
  timelineMinWidthRem: number;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onSchedule: (task: Task) => void;
};

function UndatedRow({
  task,
  projectSlug,
  railWidth,
  timelineMinWidthRem,
  canEdit,
  onOpenTask,
  onSchedule,
}: Omit<GanttUndatedSectionProps, "tasks"> & { task: Task }): JSX.Element {
  const { t } = useTranslation();
  const data: UndatedDragData = { kind: "undated-task", taskId: task.id };
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `gantt-undated:${task.id}`,
    data,
    disabled: !canEdit,
  });

  return (
    <div
      className="flex items-stretch border-b border-border/70"
      data-gantt-undated={task.id}
    >
      <div
        className={cn(
          "sticky left-0 z-[11] flex shrink-0 items-center gap-1 border-r border-border bg-background px-1.5 py-1.5 sm:px-2",
          isDragging && "opacity-50",
        )}
        style={{ width: railWidth }}
      >
        {canEdit ? (
          <button
            ref={setNodeRef}
            type="button"
            {...listeners}
            {...attributes}
            aria-label={t("tasks:gantt.dragToSchedule", { title: task.title })}
            className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-muted"
        >
          <span className="flex w-full items-center gap-1.5">
            <span className="max-w-[7rem] truncate rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-secondary-foreground sm:max-w-none">
              {getStatusLabel(task.status)}
            </span>
            {projectSlug && task.number != null ? (
              <span className="truncate text-[10px] text-muted-foreground">
                {projectSlug}-{task.number}
              </span>
            ) : null}
          </span>
          <span className="w-full truncate text-xs font-medium leading-tight text-foreground">
            {task.title}
          </span>
        </button>
        {canEdit ? (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 touch-manipulation"
            aria-label={t("tasks:gantt.scheduleTask", { title: task.title })}
            onClick={() => onSchedule(task)}
          >
            <CalendarPlus className="size-3.5" />
            <span className="hidden sm:inline">
              {t("tasks:gantt.schedule")}
            </span>
          </Button>
        ) : null}
      </div>
      <div
        className="min-h-11 shrink-0"
        style={{ minWidth: `${timelineMinWidthRem}rem` }}
      />
    </div>
  );
}

/**
 * Tasks the filters keep that have no dates yet. Each can be dragged onto
 * the timeline (it starts on the day it is dropped on) or scheduled from
 * today with the button, which is also the keyboard path.
 */
export default function GanttUndatedSection({
  tasks,
  ...rowProps
}: GanttUndatedSectionProps): JSX.Element | null {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;

  return (
    <section aria-label={t("tasks:gantt.noDates")}>
      <div className="flex border-b border-border/70 bg-muted/30">
        <div
          className="sticky left-0 z-[11] shrink-0 border-r border-border bg-muted/30 px-3 py-1.5"
          style={{ width: rowProps.railWidth }}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("tasks:gantt.noDatesCount", { count: tasks.length })}
          </p>
          {rowProps.canEdit ? (
            <p className="text-[11px] text-muted-foreground">
              {t("tasks:gantt.noDatesHint")}
            </p>
          ) : null}
        </div>
        <div
          className="shrink-0"
          style={{ minWidth: `${rowProps.timelineMinWidthRem}rem` }}
        />
      </div>
      {tasks.map((task) => (
        <UndatedRow key={task.id} task={task} {...rowProps} />
      ))}
    </section>
  );
}
