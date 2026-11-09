import { useDraggable } from "@dnd-kit/core";
import { isBefore, startOfDay } from "date-fns";
import { Check } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import {
  type AssigneeFields,
  embeddedAssignees,
  formatAssigneeSummary,
} from "@/lib/task-assignees";
import { parseTaskDate } from "@/lib/task-schedule";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { PackableTask, WeekSegment } from "./month-grid-model";
import {
  type ScheduleFieldDisplay,
  scheduleFieldText,
} from "./schedule-field-display";
import {
  isClosedTone,
  PriorityDot,
  type ToneInfo,
  toneOf,
  toneStyle,
} from "./status-tone";

export type CalendarTask = PackableTask &
  AssigneeFields & {
    title: string;
    number: number | null;
    status: string;
    priority?: string | null;
    dueDate?: string | null;
  };

/** A due date before today on a task that is still open. */
export function isCalendarTaskOverdue(
  task: Pick<CalendarTask, "dueDate">,
  closed: boolean,
  today: Date = new Date(),
): boolean {
  if (closed || !task.dueDate) return false;
  const due = parseTaskDate(task.dueDate);
  return due !== null && isBefore(startOfDay(due), startOfDay(today));
}

/**
 * The chip's look: the status tint with a solid leading edge and the tone's
 * text colour. Overdue chips take a red edge; closed ones are muted and
 * struck through. Expects `toneStyle()` on the same element.
 */
export function calendarChipClass({
  closed,
  overdue,
}: {
  closed: boolean;
  overdue: boolean;
}): string {
  return cn(
    "border border-(color:--tone)/25 border-l-[3px] bg-(color:--tone-tint) hover:border-(color:--tone)/50 hover:shadow-sm",
    overdue ? "border-l-destructive" : "border-l-(color:--tone)",
    closed ? "text-muted-foreground line-through" : "text-(color:--tone-fg)",
  );
}

type CalendarTaskBarProps = {
  segment: WeekSegment<CalendarTask>;
  projectSlug?: string;
  onOpenTask: (taskId: string) => void;
  /** Only people who can edit dates can drag a bar to another day. */
  canDrag?: boolean;
  /** The days this segment covers, so a drop knows which day was grabbed. */
  dragDays?: Date[];
  /** Status tones by slug, from the project's columns. */
  tones?: ReadonlyMap<string, ToneInfo>;
  /** The custom field chosen to show on tasks, if any. */
  field?: ScheduleFieldDisplay | null;
};

export type CalendarDragData = { taskId: string; days: Date[] };

export default function CalendarTaskBar({
  segment,
  projectSlug,
  onOpenTask,
  canDrag = false,
  dragDays = [],
  tones,
  field,
}: CalendarTaskBarProps): JSX.Element {
  const { t } = useTranslation();
  const dragData: CalendarDragData = {
    taskId: segment.task.id,
    days: dragDays,
  };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    // A task crossing a week edge has one bar per week row.
    id: `calendar-bar:${segment.task.id}:${dragDays[0]?.getTime() ?? 0}`,
    data: dragData,
    disabled: !canDrag,
  });
  const showAssignees = useUserPreferencesStore((state) => state.showAssignees);
  const {
    task,
    lane,
    columnStart,
    columnEnd,
    continuesBefore,
    continuesAfter,
  } = segment;

  const taskKey =
    projectSlug && task.number != null
      ? `${projectSlug}-${task.number}`
      : undefined;

  const range = `${formatDateShort(task.scheduleStart)} – ${formatDateShort(
    task.scheduleEnd,
  )}`;
  const assignees = embeddedAssignees(task);
  const toneInfo = toneOf(task.status, tones);
  const closed = isClosedTone(toneInfo.tone);
  const done = toneInfo.tone === "completed";
  const overdue = isCalendarTaskOverdue(task, closed);
  const fieldValue = field?.values.get(task.id);
  const fieldText = scheduleFieldText(field, task.id, t);
  const titleParts = [
    taskKey,
    task.title,
    range,
    overdue ? t("tasks:calendar.overdue") : undefined,
    fieldText ?? undefined,
    assignees.length > 0 ? formatAssigneeSummary(assignees, t) : undefined,
  ].filter(Boolean);

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(canDrag ? listeners : {})}
      style={{
        ...toneStyle(toneInfo),
        gridColumn: `${columnStart} / ${columnEnd}`,
        // Row 1 holds the date numbers, so lanes start at row 2.
        gridRow: lane + 2,
      }}
      title={titleParts.join(" · ")}
      aria-label={[
        t("tasks:calendar.taskAriaLabel", { title: task.title, range }),
        overdue ? t("tasks:calendar.overdue") : null,
        fieldText,
      ]
        .filter(Boolean)
        .join(" · ")}
      data-task-status={task.status}
      data-tone={toneInfo.tone}
      data-overdue={overdue || undefined}
      onClick={() => onOpenTask(task.id)}
      className={cn(
        "z-10 mb-0.5 flex h-6 min-w-0 items-center gap-1 overflow-hidden px-1.5 text-left text-[11px] font-medium leading-none transition-[box-shadow,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-5",
        calendarChipClass({ closed, overdue }),
        canDrag && "cursor-grab touch-manipulation active:cursor-grabbing",
        isDragging && "opacity-40",
        // Bars that run past a week edge lose their cap there so the two halves
        // read as one continuous span across rows.
        continuesBefore ? "rounded-l-none border-l-0" : "ml-1 rounded-l-[4px]",
        continuesAfter ? "rounded-r-none border-r-0" : "mr-1 rounded-r-[4px]",
      )}
    >
      {done ? (
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="size-3 shrink-0 text-(color:--tone)"
        />
      ) : (
        <PriorityDot priority={task.priority} />
      )}
      <span className="truncate">{task.title}</span>
      {fieldValue ? (
        <span
          data-testid="calendar-field-value"
          className="max-w-[45%] shrink-0 truncate font-normal opacity-75"
        >
          {fieldValue}
        </span>
      ) : null}
      {showAssignees && assignees.length > 0 && (
        <AssigneeAvatarStack
          assignees={assignees}
          max={2}
          size="xs"
          ring="background"
          decorative
          className="ml-auto pl-1"
        />
      )}
    </button>
  );
}
