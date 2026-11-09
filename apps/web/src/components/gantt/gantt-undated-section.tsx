import { useDraggable } from "@dnd-kit/core";
import { CalendarPlus, GripVertical } from "lucide-react";
import type { CSSProperties, JSX } from "react";
import { useTranslation } from "react-i18next";
import {
  PriorityGlyph,
  type ToneInfo,
  toneOf,
  toneStyle,
} from "@/components/calendar/status-tone";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getPriorityLabel, getStatusLabel } from "@/lib/i18n/domain";
import type Task from "@/types/task";

export type UndatedDragData = { kind: "undated-task"; taskId: string };

/**
 * The sticky cell beside the timeline. Wide, it is the chart's visible width
 * and gives that width back, so the list makes the chart no wider.
 */
function cellStyle(railWidth: string, wide = false): CSSProperties {
  return wide
    ? { width: "100cqw", marginInlineEnd: "-100cqw" }
    : { width: railWidth };
}

type GanttUndatedSectionProps = {
  tasks: Task[];
  projectSlug?: string;
  /** Width of the left list, as a CSS length. */
  railWidth: string;
  /**
   * On a phone the task list column is too narrow for a title, so the list
   * spans the chart's visible width instead (the chart is a size container)
   * and a title takes up to two lines.
   */
  wide?: boolean;
  timelineMinWidthRem: number;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onSchedule: (task: Task) => void;
  /** Status tones by slug, from the project's columns. */
  tones?: ReadonlyMap<string, ToneInfo>;
};

function UndatedRow({
  task,
  projectSlug,
  railWidth,
  wide = false,
  timelineMinWidthRem,
  canEdit,
  onOpenTask,
  onSchedule,
  tones,
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
      className="group/undated flex items-stretch"
      data-gantt-undated={task.id}
    >
      <div
        className="sticky left-0 z-[11] shrink-0 border-r border-border bg-background px-1.5 py-1 group-last/undated:pb-2 sm:px-2"
        style={cellStyle(railWidth, wide)}
      >
        {/* A dashed card: the task is waiting for dates. */}
        <div
          className={cn(
            "flex min-w-0 items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 bg-card py-0.5 pr-0.5 pl-1",
            isDragging && "border-primary opacity-50",
          )}
        >
          {canEdit ? (
            <button
              ref={setNodeRef}
              type="button"
              {...listeners}
              {...attributes}
              aria-label={t("tasks:gantt.dragToSchedule", {
                title: task.title,
              })}
              className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              <GripVertical className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenTask(task.id)}
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              style={toneStyle(toneOf(task.status, tones))}
              className="size-2 shrink-0 rounded-full bg-(color:--tone) ring-2 ring-(color:--tone)/20"
            />
            <span className="sr-only">{getStatusLabel(task.status)}</span>
            {projectSlug && task.number != null ? (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {projectSlug}-{task.number}
              </span>
            ) : null}
            <span
              className={cn(
                "min-w-0 flex-1 text-xs font-medium text-foreground",
                wide ? "line-clamp-2 break-words" : "truncate",
              )}
            >
              {task.title}
            </span>
            <PriorityGlyph
              priority={task.priority}
              label={getPriorityLabel(task.priority ?? "no-priority")}
            />
          </button>
          {canEdit ? (
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 touch-manipulation text-primary hover:bg-primary/10 hover:text-primary"
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
      </div>
      <div
        className="min-h-11 shrink-0 sm:min-h-10"
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
    <section
      aria-label={t("tasks:gantt.noDates")}
      // The bottom gap sits inside the last row's task-list cell, which is
      // opaque; padding here showed the timeline's grid under the list.
      className="border-t border-dashed border-muted-foreground/40"
    >
      <div className="flex">
        <div
          className="sticky left-0 z-[11] shrink-0 border-r border-border bg-background px-3 pt-2.5 pb-1"
          style={cellStyle(rowProps.railWidth, rowProps.wide)}
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
