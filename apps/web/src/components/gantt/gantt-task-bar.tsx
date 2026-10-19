import { addDays, differenceInCalendarDays } from "date-fns";
import { Check } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isClosedTone,
  PriorityDot,
  type ToneInfo,
  toneStyle,
} from "@/components/calendar/status-tone";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import { useUpdateTaskDates } from "@/hooks/mutations/task/use-update-task-dates";
import { cn } from "@/lib/cn";
import { toTaskDateValue } from "@/lib/schedule-dates";
import { embeddedAssignees } from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";

const CLICK_MOVE_THRESHOLD_PX = 4;
const MOBILE_MOVE_THRESHOLD_PX = 14;
// A rough average glyph width of the bar's 12px medium text. Only decides
// whether the title goes inside the bar or beside it, so it errs wide.
const TITLE_CHAR_PX = 6.6;
const AVATAR_PX = 12;

type ScheduledTask = Task & {
  scheduleStart: Date;
  scheduleEnd: Date;
};

type GanttTaskBarProps = {
  task: ScheduledTask;
  timeline: {
    days: Date[];
    rangeStart: Date;
    gridTemplateColumns: string;
  };
  pixelsPerDay: number;
  isMobile?: boolean;
  /** Without task:update the bar only opens the task. */
  canEdit?: boolean;
  onOpenTask: () => void;
  /** The task's status colour; the default columns' tone otherwise. */
  tone?: ToneInfo;
};

function getBarGridColumns(
  scheduleStart: Date,
  scheduleEnd: Date,
  rangeStart: Date,
  trackCount: number,
): { barInView: boolean; lineStart: number; lineEnd: number } {
  const startIndex = differenceInCalendarDays(scheduleStart, rangeStart);
  const endIndex = differenceInCalendarDays(scheduleEnd, rangeStart);
  const barInView = endIndex >= 0 && startIndex < trackCount && trackCount > 0;
  if (!barInView) {
    return { barInView: false, lineStart: 1, lineEnd: 1 };
  }
  const lineStart = Math.max(1, Math.min(startIndex + 1, trackCount));
  const lineEnd = Math.max(
    lineStart + 1,
    Math.min(endIndex + 2, trackCount + 1),
  );
  return { barInView: true, lineStart, lineEnd };
}

export function GanttTaskBar({
  task,
  timeline,
  pixelsPerDay,
  isMobile = false,
  canEdit = true,
  onOpenTask,
  tone = { tone: "unstarted" },
}: GanttTaskBarProps) {
  const { t } = useTranslation();
  const showAssignees = useUserPreferencesStore((state) => state.showAssignees);
  const assignees = embeddedAssignees(task);
  const { mutateAsync: updateTaskDates } = useUpdateTaskDates();
  const [dragDisplay, setDragDisplay] = useState<{
    start: Date;
    end: Date;
  } | null>(null);

  // Drop the drag overlay once server data matches
  useEffect(() => {
    if (!dragDisplay) return;
    const startMatches =
      differenceInCalendarDays(task.scheduleStart, dragDisplay.start) === 0;
    const endMatches =
      differenceInCalendarDays(task.scheduleEnd, dragDisplay.end) === 0;
    if (startMatches && endMatches) {
      setDragDisplay(null);
    }
  }, [dragDisplay, task.scheduleEnd, task.scheduleStart]);

  const displayStart = dragDisplay?.start ?? task.scheduleStart;
  const displayEnd = dragDisplay?.end ?? task.scheduleEnd;

  const trackCount = timeline.days.length;
  const { barInView, lineStart, lineEnd } = getBarGridColumns(
    displayStart,
    displayEnd,
    timeline.rangeStart,
    trackCount,
  );

  const startIsVisible =
    differenceInCalendarDays(task.scheduleStart, timeline.rangeStart) >= 0;
  const endIsVisible =
    differenceInCalendarDays(task.scheduleEnd, timeline.rangeStart) <
    trackCount;

  const persistDates = useCallback(
    async (nextStart: Date, nextEnd: Date): Promise<boolean> => {
      try {
        await updateTaskDates({
          task,
          startDate: toTaskDateValue(nextStart),
          dueDate: toTaskDateValue(nextEnd),
        });
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:gantt.updateDatesError"),
        );
        return false;
      }
    },
    [task, updateTaskDates, t],
  );

  const pxPerDay = Math.max(pixelsPerDay, 1e-6);
  const moveThresholdPx = isMobile
    ? MOBILE_MOVE_THRESHOLD_PX
    : CLICK_MOVE_THRESHOLD_PX;

  const handleResizeLeftPointerDown = (event: React.PointerEvent) => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const initialStart = task.scheduleStart;
    const initialEnd = task.scheduleEnd;
    const startIdx = differenceInCalendarDays(
      initialStart,
      timeline.rangeStart,
    );
    const endIdx = differenceInCalendarDays(initialEnd, timeline.rangeStart);

    const onMove = (ev: PointerEvent) => {
      const deltaDays = Math.round((ev.clientX - originX) / pxPerDay);
      let nextStartIdx = startIdx + deltaDays;
      nextStartIdx = Math.max(0, Math.min(nextStartIdx, endIdx));
      const nextStart = timeline.days[nextStartIdx] ?? initialStart;
      const nextEnd = initialEnd;
      setDragDisplay({ start: nextStart, end: nextEnd });
    };

    const onUp = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (ev.type === "pointercancel") {
        setDragDisplay(null);
        return;
      }
      const deltaDays = Math.round((ev.clientX - originX) / pxPerDay);
      let nextStartIdx = startIdx + deltaDays;
      nextStartIdx = Math.max(0, Math.min(nextStartIdx, endIdx));
      const nextStart = timeline.days[nextStartIdx] ?? initialStart;
      if (nextStart.getTime() === initialStart.getTime()) {
        setDragDisplay(null);
        return;
      }
      const ok = await persistDates(nextStart, initialEnd);
      if (!ok) {
        setDragDisplay(null);
      }
    };

    const onCancel = onUp;

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const handleResizeRightPointerDown = (event: React.PointerEvent) => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const initialStart = task.scheduleStart;
    const initialEnd = task.scheduleEnd;
    const startIdx = differenceInCalendarDays(
      initialStart,
      timeline.rangeStart,
    );
    const endIdx = differenceInCalendarDays(initialEnd, timeline.rangeStart);

    const onMove = (ev: PointerEvent) => {
      const deltaDays = Math.round((ev.clientX - originX) / pxPerDay);
      let nextEndIdx = endIdx + deltaDays;
      nextEndIdx = Math.max(startIdx, Math.min(nextEndIdx, trackCount - 1));
      const nextEnd = timeline.days[nextEndIdx] ?? initialEnd;
      const nextStart = initialStart;
      setDragDisplay({ start: nextStart, end: nextEnd });
    };

    const onUp = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (ev.type === "pointercancel") {
        setDragDisplay(null);
        return;
      }
      const deltaDays = Math.round((ev.clientX - originX) / pxPerDay);
      let nextEndIdx = endIdx + deltaDays;
      nextEndIdx = Math.max(startIdx, Math.min(nextEndIdx, trackCount - 1));
      const nextEnd = timeline.days[nextEndIdx] ?? initialEnd;
      if (nextEnd.getTime() === initialEnd.getTime()) {
        setDragDisplay(null);
        return;
      }
      const ok = await persistDates(initialStart, nextEnd);
      if (!ok) {
        setDragDisplay(null);
      }
    };

    const onCancel = onUp;

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const handleMovePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const originX = event.clientX;
    const initialStart = task.scheduleStart;
    const initialEnd = task.scheduleEnd;
    if (!canEdit || !startIsVisible || !endIsVisible) {
      onOpenTask();
      return;
    }
    const durationDays = differenceInCalendarDays(initialEnd, initialStart);
    const startIdx = differenceInCalendarDays(
      initialStart,
      timeline.rangeStart,
    );

    const onMove = (ev: PointerEvent) => {
      const deltaDays = Math.round((ev.clientX - originX) / pxPerDay);
      let nextStartIdx = startIdx + deltaDays;
      const maxStart = trackCount - 1 - durationDays;
      nextStartIdx = Math.max(0, Math.min(nextStartIdx, maxStart));
      const nextStart = timeline.days[nextStartIdx] ?? initialStart;
      const nextEnd = addDays(nextStart, durationDays);
      setDragDisplay({ start: nextStart, end: nextEnd });
    };

    const onUp = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (ev.type === "pointercancel") {
        setDragDisplay(null);
        return;
      }
      const moved = Math.abs(ev.clientX - originX);
      const deltaDays = Math.round((ev.clientX - originX) / pxPerDay);
      let nextStartIdx = startIdx + deltaDays;
      const maxStart = trackCount - 1 - durationDays;
      nextStartIdx = Math.max(0, Math.min(nextStartIdx, maxStart));
      const nextStart = timeline.days[nextStartIdx] ?? initialStart;
      const nextEnd = addDays(nextStart, durationDays);

      if (moved < moveThresholdPx) {
        setDragDisplay(null);
        onOpenTask();
        return;
      }
      if (
        nextStart.getTime() === initialStart.getTime() &&
        nextEnd.getTime() === initialEnd.getTime()
      ) {
        setDragDisplay(null);
        return;
      }
      const ok = await persistDates(nextStart, nextEnd);
      if (!ok) {
        setDragDisplay(null);
      }
    };

    const onCancel = onUp;

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  if (!barInView || lineEnd <= lineStart) {
    return null;
  }

  const done = tone.tone === "completed";
  const cancelled = tone.tone === "cancelled";
  const closed = isClosedTone(tone.tone);
  const visibleAssignees = showAssignees ? assignees.slice(0, 2) : [];
  // Whether the title (with its dot, check and faces) fits inside the bar;
  // otherwise it reads beside the bar, to the right.
  const handlesPx = isMobile ? 88 : 16;
  const barWidthPx = (lineEnd - lineStart) * pixelsPerDay - 8;
  const contentPx =
    task.title.length * TITLE_CHAR_PX +
    20 +
    (done || task.priority ? 14 : 0) +
    (visibleAssignees.length > 0 ? visibleAssignees.length * AVATAR_PX + 8 : 0);
  const titleInside = barWidthPx - handlesPx >= contentPx;
  const faces =
    visibleAssignees.length > 0 ? (
      <AssigneeAvatarStack
        assignees={assignees}
        max={2}
        size="xs"
        ring="background"
        decorative
        className="shrink-0"
      />
    ) : null;
  const leading = done ? (
    <Check aria-hidden="true" strokeWidth={3} className="size-3 shrink-0" />
  ) : (
    <PriorityDot priority={task.priority} className="ring-1 ring-background" />
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1] grid items-center"
      style={{
        gridTemplateColumns: timeline.gridTemplateColumns,
      }}
    >
      <div
        style={
          {
            ...toneStyle(tone),
            // Text on a solid (done) bar: the tone, darkened to an ink.
            "--tone-ink": "color-mix(in srgb, var(--tone) 22%, #000)",
            gridColumn: `${lineStart} / ${lineEnd}`,
          } as CSSProperties
        }
        data-tone={tone.tone}
        data-done={done || undefined}
        className="relative mx-1 flex min-w-0 items-center"
      >
        <div
          className={cn(
            "group pointer-events-auto relative flex min-h-[44px] w-full min-w-0 items-stretch overflow-hidden rounded-md border text-left text-xs font-medium leading-none shadow-xs transition-[box-shadow,border-color] hover:shadow-md sm:h-7 sm:min-h-0",
            done
              ? "border-(color:--tone) bg-(color:--tone) text-(color:--tone-ink)"
              : "border-(color:--tone)/40 bg-(color:--tone-tint) text-(color:--tone-fg) hover:border-(color:--tone)/70",
            cancelled && "text-muted-foreground line-through",
          )}
        >
          <button
            type="button"
            aria-label={t("tasks:gantt.resizeStart")}
            disabled={!canEdit || !startIsVisible}
            onPointerDown={handleResizeLeftPointerDown}
            className={cn(
              "relative z-20 shrink-0 cursor-ew-resize touch-none hover:bg-(color:--tone)/25 disabled:cursor-default",
              "min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:w-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
          >
            {/* The solid cap that marks the status on an open bar. */}
            {done || !startIsVisible ? null : (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-(color:--tone)"
              />
            )}
          </button>
          <button
            type="button"
            aria-label={t("tasks:gantt.taskAriaLabel", { title: task.title })}
            title={task.title}
            className={cn(
              "relative z-10 flex min-h-[44px] min-w-0 flex-1 touch-manipulation items-center gap-1.5 overflow-hidden px-1.5 text-left sm:min-h-0",
              canEdit && "cursor-grab active:cursor-grabbing",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
            onPointerDown={handleMovePointerDown}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenTask();
              }
            }}
          >
            {titleInside ? (
              <>
                {leading}
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {faces}
              </>
            ) : done && barWidthPx - handlesPx >= 16 ? (
              leading
            ) : null}
          </button>
          <button
            type="button"
            aria-label={t("tasks:gantt.resizeDue")}
            disabled={!canEdit || !endIsVisible}
            onPointerDown={handleResizeRightPointerDown}
            className={cn(
              "relative z-20 shrink-0 cursor-ew-resize touch-none hover:bg-(color:--tone)/25 disabled:cursor-default",
              "min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:w-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
          />
        </div>
        {titleInside ? null : (
          // Beside the bar: the bar's own button already names the task.
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute left-full ml-1.5 flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-background/85 px-1 text-xs font-medium text-foreground",
              closed && "text-muted-foreground",
              cancelled && "line-through",
            )}
          >
            {done ? null : <PriorityDot priority={task.priority} />}
            {task.title}
            {faces}
          </span>
        )}
      </div>
    </div>
  );
}
