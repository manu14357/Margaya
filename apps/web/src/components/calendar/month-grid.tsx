import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { format, isSameMonth, isToday } from "date-fns";
import { type JSX, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { dayIndexAtPointer } from "@/lib/schedule-dates";
import CalendarDayCell from "./calendar-day-cell";
import CalendarTaskBar, {
  type CalendarDragData,
  type CalendarTask,
  calendarChipClass,
} from "./calendar-task-bar";
import DayOverflowPopover from "./day-overflow-popover";
import {
  packWeekLanes,
  toVisibleColumns,
  visibleDayIndexes,
} from "./month-grid-model";
import { isClosedTone, type ToneInfo, toneOf, toneStyle } from "./status-tone";

type MonthGridProps = {
  weeks: Date[][];
  tasks: CalendarTask[];
  /** Days outside it are dimmed; leave it out for the week view. */
  visibleMonth?: Date;
  maxLanes: number;
  projectSlug?: string;
  onOpenTask: (taskId: string) => void;
  showWeekends?: boolean;
  /** Drag to reschedule: only for people who can edit task dates. */
  canEditDates?: boolean;
  onReschedule?: (taskId: string, grabbedDay: Date, dropDay: Date) => void;
  /** Present when the viewer can create tasks; gets the "+" to anchor to. */
  onCreateTask?: (day: Date, anchor: HTMLElement) => void;
  /** Status tones by slug, from the project's columns. */
  tones?: ReadonlyMap<string, ToneInfo>;
};

function pointerClientX(event: Event): number | null {
  if ("clientX" in event && typeof event.clientX === "number") {
    return event.clientX;
  }
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    return event.touches[0]?.clientX ?? null;
  }
  return null;
}

export default function MonthGrid({
  weeks,
  tasks,
  visibleMonth,
  maxLanes,
  projectSlug,
  onOpenTask,
  showWeekends = true,
  canEditDates = false,
  onReschedule,
  onCreateTask,
  tones,
}: MonthGridProps): JSX.Element {
  // Without a month to dim against, this is the week view: one tall row with
  // the dates in the column headers.
  const isWeekView = !visibleMonth;
  const weekdayTemplate = weeks[0] ?? [];
  const visibleIndexes = useMemo(
    () => visibleDayIndexes(weekdayTemplate, showWeekends),
    [weekdayTemplate, showWeekends],
  );
  const layouts = useMemo(
    () => weeks.map((week) => packWeekLanes(week, tasks, maxLanes)),
    [weeks, tasks, maxLanes],
  );
  const canDrag = canEditDates && Boolean(onReschedule);
  const grabbedDayRef = useRef<Date | null>(null);
  const [draggedTask, setDraggedTask] = useState<CalendarTask | null>(null);

  // Same thresholds as the board: a short press still opens the task.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 10 },
    }),
  );

  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const data = active.data.current as CalendarDragData | undefined;
    const rect = active.rect.current.initial;
    const clientX = pointerClientX(activatorEvent);
    const days = data?.days ?? [];
    grabbedDayRef.current =
      rect && clientX !== null
        ? (days[
            dayIndexAtPointer(clientX, rect.left, rect.width, days.length)
          ] ?? null)
        : (days[days.length - 1] ?? null);
    setDraggedTask(tasks.find((task) => task.id === data?.taskId) ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const data = active.data.current as CalendarDragData | undefined;
    const dropDay = (over?.data.current as { day?: Date } | undefined)?.day;
    const grabbedDay = grabbedDayRef.current;
    grabbedDayRef.current = null;
    setDraggedTask(null);
    if (!data || !dropDay || !grabbedDay) return;
    if (dropDay.getTime() === grabbedDay.getTime()) return;
    onReschedule?.(data.taskId, grabbedDay, dropDay);
  };

  const handleDragCancel = () => {
    grabbedDayRef.current = null;
    setDraggedTask(null);
  };

  const columnTemplate = `repeat(${visibleIndexes.length}, minmax(0, 1fr))`;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-x-contain">
        <div
          className="sticky top-0 z-30 grid border-b border-border bg-background/95 backdrop-blur"
          style={{ gridTemplateColumns: columnTemplate }}
        >
          {visibleIndexes.map((dayIndex) => {
            const day = weekdayTemplate[dayIndex];
            const today = isWeekView && isToday(day);
            return (
              <div
                key={`weekday-${day.toISOString()}`}
                className={cn(
                  "flex items-center justify-center gap-1.5 border-r border-border/60 px-1 text-center",
                  isWeekView ? "py-1.5" : "py-2",
                  today && "bg-(color:--today-tint)",
                )}
              >
                <span
                  data-weekday-label
                  className={cn(
                    "text-[11px] font-medium uppercase tracking-wide",
                    today ? "text-(color:--today)" : "text-muted-foreground",
                  )}
                >
                  {formatDate(day, { weekday: "short" })}
                </span>
                {isWeekView ? (
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                      today
                        ? "bg-(color:--today) text-background"
                        : "text-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {weeks.map((week, weekIndex) => {
            const { segments, hiddenCountByDay, tasksByDay } =
              layouts[weekIndex];

            return (
              <div
                key={`week-${week[0].toISOString()}`}
                className={cn(
                  "relative grid flex-1 border-b border-border/70",
                  isWeekView ? "min-h-96" : "min-h-24 sm:min-h-28",
                )}
                style={{
                  gridTemplateColumns: columnTemplate,
                  // Row 1 carries the date numbers, then one row per lane,
                  // then a trailing row for the per-day overflow hint, which takes
                  // the spare height so the lanes stay at the top.
                  gridTemplateRows: `auto repeat(${maxLanes}, min-content) minmax(auto, 1fr)`,
                }}
              >
                {visibleIndexes.map((dayIndex, position) => (
                  <CalendarDayCell
                    key={`cell-${week[dayIndex].toISOString()}`}
                    day={week[dayIndex]}
                    column={position + 1}
                    canDrop={canDrag}
                    onCreateTask={onCreateTask}
                    outsideMonth={
                      visibleMonth !== undefined &&
                      !isSameMonth(week[dayIndex], visibleMonth)
                    }
                  />
                ))}

                {visibleIndexes.map((dayIndex, position) => {
                  const day = week[dayIndex];
                  return (
                    <div
                      key={`number-${day.toISOString()}`}
                      style={{ gridColumn: position + 1, gridRow: 1 }}
                      className="pointer-events-none z-10 flex h-7 justify-end px-1 py-1"
                    >
                      {/* The week view shows its dates in the column headers. */}
                      {visibleMonth ? (
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
                            !isSameMonth(day, visibleMonth) &&
                              "text-muted-foreground",
                            isToday(day) &&
                              "bg-(color:--today) font-semibold text-background",
                          )}
                        >
                          {format(day, "d")}
                        </span>
                      ) : null}
                    </div>
                  );
                })}

                {segments.map((segment) => {
                  const columns = toVisibleColumns(segment, visibleIndexes);
                  if (!columns) return null;
                  const dragDays = visibleIndexes
                    .slice(columns.columnStart - 1, columns.columnEnd - 1)
                    .map((dayIndex) => week[dayIndex]);
                  return (
                    <CalendarTaskBar
                      key={`bar-${segment.task.id}`}
                      segment={{ ...segment, ...columns }}
                      projectSlug={projectSlug}
                      onOpenTask={onOpenTask}
                      canDrag={canDrag}
                      dragDays={dragDays}
                      tones={tones}
                    />
                  );
                })}

                {visibleIndexes.map((dayIndex, position) => {
                  const day = week[dayIndex];
                  return hiddenCountByDay[dayIndex] > 0 ? (
                    <div
                      key={`overflow-${day.toISOString()}`}
                      style={{
                        gridColumn: position + 1,
                        gridRow: maxLanes + 2,
                      }}
                      className="z-10 min-w-0"
                    >
                      <DayOverflowPopover
                        day={day}
                        tasks={tasksByDay[dayIndex]}
                        hiddenCount={hiddenCountByDay[dayIndex]}
                        projectSlug={projectSlug}
                        onOpenTask={onOpenTask}
                        tones={tones}
                      />
                    </div>
                  ) : null;
                })}
              </div>
            );
          })}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggedTask ? (
          <div className="max-w-48 rounded-[4px] bg-background shadow-lg ring-2 ring-primary/40">
            <div
              style={toneStyle(toneOf(draggedTask.status, tones))}
              className={cn(
                "flex h-6 items-center rounded-[4px] px-1.5 text-[11px] font-medium sm:h-5",
                calendarChipClass({
                  closed: isClosedTone(toneOf(draggedTask.status, tones).tone),
                  overdue: false,
                }),
              )}
            >
              <span className="truncate">{draggedTask.title}</span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
