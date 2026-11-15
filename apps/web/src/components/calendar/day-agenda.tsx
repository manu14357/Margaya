import { differenceInCalendarDays } from "date-fns";
import { CalendarClock, CalendarDays, Check, Plus } from "lucide-react";
import { type JSX, useId } from "react";
import { useTranslation } from "react-i18next";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatDate, formatDateShort } from "@/lib/format";
import { getPriorityLabel, getStatusDisplayLabel } from "@/lib/i18n/domain";
import { embeddedAssignees, formatAssigneeSummary } from "@/lib/task-assignees";
import { type CalendarTask, isCalendarTaskOverdue } from "./calendar-task-bar";
import {
  isClosedTone,
  PriorityGlyph,
  priorityColor,
  type ToneInfo,
  toneOf,
  toneStyle,
} from "./status-tone";

type DayAgendaProps = {
  day: Date;
  /** Every task on the day, in display order. */
  tasks: CalendarTask[];
  projectSlug?: string;
  tones?: ReadonlyMap<string, ToneInfo>;
  /** Column names by status slug, for the status label. */
  statusNames?: ReadonlyMap<string, string>;
  isLoading?: boolean;
  onOpenTask: (taskId: string) => void;
  /** Present when the viewer can create tasks. */
  onCreateTask?: (day: Date, anchor: HTMLElement) => void;
  /** Present when the viewer can edit dates: opens "Move to date". */
  onMoveTask?: (task: CalendarTask) => void;
  className?: string;
};

/**
 * The selected day's tasks as full-width rows, for touch screens and phones:
 * each row opens its task, and "Move to date" reschedules it without
 * dragging. "Add task" opens the calendar's quick add for this day.
 */
export default function DayAgenda({
  day,
  tasks,
  projectSlug,
  tones,
  statusNames,
  isLoading = false,
  onOpenTask,
  onCreateTask,
  onMoveTask,
  className,
}: DayAgendaProps): JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-calendar-region="day-agenda"
      className={cn("flex min-w-0 flex-col bg-background", className)}
    >
      <div className="flex items-center gap-2 border-border/80 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            className="truncate font-semibold text-foreground text-sm"
          >
            {formatDate(day, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h2>
          {isLoading ? null : (
            <p className="text-muted-foreground text-xs tabular-nums">
              {t("tasks:calendar.touch.taskCount", { count: tasks.length })}
            </p>
          )}
        </div>
        {onCreateTask ? (
          <Button
            variant="outline"
            className="h-11 shrink-0 sm:h-11"
            onClick={(event) => onCreateTask(day, event.currentTarget)}
          >
            <Plus />
            {t("tasks:calendar.touch.addTask")}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2 p-3" aria-busy="true">
          <span className="sr-only">{t("common:empty.loading")}</span>
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <CalendarDays
            aria-hidden="true"
            className="size-6 text-muted-foreground/70"
          />
          <p className="text-muted-foreground text-sm">
            {t("tasks:calendar.touch.empty")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5 p-2">
          {tasks.map((task) => (
            <AgendaRow
              key={task.id}
              task={task}
              projectSlug={projectSlug}
              tones={tones}
              statusNames={statusNames}
              onOpenTask={onOpenTask}
              onMoveTask={onMoveTask}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AgendaRow({
  task,
  projectSlug,
  tones,
  statusNames,
  onOpenTask,
  onMoveTask,
}: {
  task: CalendarTask;
  projectSlug?: string;
  tones?: ReadonlyMap<string, ToneInfo>;
  statusNames?: ReadonlyMap<string, string>;
  onOpenTask: (taskId: string) => void;
  onMoveTask?: (task: CalendarTask) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const toneInfo = toneOf(task.status, tones);
  const closed = isClosedTone(toneInfo.tone);
  const overdue = isCalendarTaskOverdue(task, closed);
  const taskKey =
    projectSlug && task.number != null ? `${projectSlug}-${task.number}` : null;
  const multiDay =
    differenceInCalendarDays(task.scheduleEnd, task.scheduleStart) > 0;
  const assignees = embeddedAssignees(task);
  const status = getStatusDisplayLabel(
    task.status,
    statusNames?.get(task.status),
  );

  return (
    <li
      style={toneStyle(toneInfo)}
      data-agenda-task={task.id}
      className="flex min-h-14 items-stretch overflow-hidden rounded-lg border border-border/80 border-l-[3px] border-l-(color:--tone) bg-card shadow-xs/5"
    >
      <button
        type="button"
        onClick={() => onOpenTask(task.id)}
        className="flex min-w-0 flex-1 touch-manipulation items-center gap-2 px-2.5 py-2 text-left outline-none transition-colors hover:bg-(color:--tone-tint) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "line-clamp-2 break-words font-medium text-[13px] leading-[18px]",
              closed ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {task.title}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
            {taskKey ? (
              <span className="font-mono tabular-nums">{taskKey}</span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              {closed ? (
                <Check
                  aria-hidden="true"
                  strokeWidth={3}
                  className="size-3 text-(color:--tone)"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-(color:--tone)"
                />
              )}
              {status}
            </span>
            {multiDay ? (
              <span className="tabular-nums">
                {formatDateShort(task.scheduleStart)} –{" "}
                {formatDateShort(task.scheduleEnd)}
              </span>
            ) : null}
            {overdue ? (
              <span className="inline-flex items-center gap-1 font-medium text-destructive-foreground">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-destructive"
                />
                {t("tasks:calendar.overdue")}
              </span>
            ) : null}
            {priorityColor(task.priority) ? (
              <PriorityGlyph
                priority={task.priority}
                label={getPriorityLabel(task.priority ?? "")}
                className="size-3"
              />
            ) : null}
          </span>
        </span>
        {assignees.length > 0 ? (
          <>
            <span className="sr-only">
              {formatAssigneeSummary(assignees, t)}
            </span>
            <AssigneeAvatarStack
              assignees={assignees}
              max={2}
              size="md"
              ring="card"
              decorative
              className="shrink-0"
            />
          </>
        ) : null}
      </button>
      {onMoveTask ? (
        <Button
          variant="ghost"
          className="h-auto min-h-11 w-11 shrink-0 rounded-none border-0 border-border/60 border-l px-0 sm:h-auto"
          aria-label={t("tasks:calendar.touch.moveTask", { title: task.title })}
          onClick={() => onMoveTask(task)}
        >
          <CalendarClock aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}
