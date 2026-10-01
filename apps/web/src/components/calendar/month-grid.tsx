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
  getCalendarTaskStatusClass,
} from "./calendar-task-bar";
import DayOverflowPopover from "./day-overflow-popover";
import {
  packWeekLanes,
  toVisibleColumns,
  visibleDayIndexes,
} from "./month-grid-model";

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
  /** Present when the viewer can create tasks. */
  onCreateTask?: (day: Date) => void;
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
}: MonthGridProps): JSX.Element {
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
            return (
              <div
                key={`weekday-${day.toISOString()}`}
                className="border-r border-border/60 px-1 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {formatDate(day, { weekday: "short" })}
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
                className="relative grid min-h-24 flex-1 border-b border-border/70 sm:min-h-28"
                style={{
                  gridTemplateColumns: columnTemplate,
                  // Row 1 carries the date numbers, then one row per lane,
                  // then a trailing row for the per-day overflow hint.
                  gridTemplateRows: `auto repeat(${maxLanes}, min-content) auto`,
                }}
              >
                {visibleIndexes.map((dayIndex, position) => (
                  <CalendarDayCell
                    key={`cell-${week[dayIndex].toISOString()}`}
                    day={week[dayIndex]}
                    column={position + 1}
                    canDrop={canDrag}
                    onCreateTask={onCreateTask}
                  />
                ))}

                {visibleIndexes.map((dayIndex, position) => {
                  const day = week[dayIndex];
                  return (
                    <div
                      key={`number-${day.toISOString()}`}
                      style={{ gridColumn: position + 1, gridRow: 1 }}
                      className="pointer-events-none z-10 flex justify-end px-1 py-1"
                    >
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full text-[11px] font-medium",
                          visibleMonth &&
                            !isSameMonth(day, visibleMonth) &&
                            "text-muted-foreground/60",
                          isToday(day) && "bg-primary text-primary-foreground",
                        )}
                      >
                        {format(day, "d")}
                      </span>
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
          <div className="max-w-48 rounded-md bg-background shadow-md">
            <div
              className={cn(
                "flex h-6 items-center rounded-md border px-1.5 text-[11px] font-medium text-foreground sm:h-5",
                getCalendarTaskStatusClass(draggedTask.status),
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
