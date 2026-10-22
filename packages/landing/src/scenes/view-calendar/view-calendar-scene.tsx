"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  AvatarStack,
  PriorityDot,
  STATUS_HUE,
  statusToneStyle,
  ViewChoice,
  viewChoiceClass,
} from "../../replica";
import {
  type Demo,
  dateOf,
  TODAY,
  VIEW_STAGE_COMPACT,
  VIEW_STAGE_SIZE,
  viewTasks,
} from "../views-shared/data";
import { ViewFrame } from "../views-shared/frame";
import {
  type CalendarMode,
  type CalendarViewAction,
  type CalendarViewState,
  calendarViewReducer,
  MONTH_START,
  MONTH_WEEKS,
  packWeek,
  WEEK_START,
} from "./state";

/** The calendar: a task is dragged to another day, then Month becomes Week. */
export function createCalendarViewScene(
  demo: Demo,
): DemoScene<CalendarViewState, CalendarViewAction> {
  return {
    id: "viewCalendar",
    initialState: { tasks: viewTasks(demo), mode: "month" },
    reducer: calendarViewReducer,
    script: [
      step.wait(700),
      step.drag("cal-a11y", "cal-day-16", {
        type: "reschedule",
        id: "a11y",
        day: 16,
      }),
      step.wait(900),
      step.click("cal-mode-week", { type: "mode", mode: "week" }),
      step.wait(2400),
    ],
    render: (props) => <CalendarView {...props} />,
  };
}

/** The app's bar colours per status group. */
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DRAG_TYPE = "text/x-margaya-task";

function CalendarView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<CalendarViewState, CalendarViewAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.viewCalendar;
  const isWeek = state.mode === "week";
  const weekStarts = isWeek
    ? [WEEK_START]
    : Array.from(
        { length: MONTH_WEEKS },
        (_, index) => MONTH_START + index * 7,
      );
  const maxLanes = isWeek ? 8 : 3;

  return (
    <ViewFrame
      view="calendar"
      compact={compact}
      taskCount={state.tasks.length}
      toolbar={
        <div className="flex items-center gap-1.5">
          <ViewChoice<CalendarMode>
            label={copy.modeLabel}
            value={state.mode}
            demoPrefix="cal-mode"
            onChange={(mode) => dispatch({ type: "mode", mode })}
            options={[
              { value: "month", label: copy.month },
              { value: "week", label: copy.week },
            ]}
          />
          {!compact && (
            <>
              <span className={viewChoiceClass(true)}>{copy.weekends}</span>
              <span className="truncate font-medium text-foreground text-xs">
                {isWeek ? copy.weekLabel : copy.monthLabel}
              </span>
            </>
          )}
          <span className="flex items-center gap-1">
            <span
              title={copy.previous}
              className="flex size-6 items-center justify-center rounded-md border border-input bg-popover text-foreground"
            >
              <ChevronLeft aria-hidden className="size-3.5" />
            </span>
            <span className="flex h-6 items-center rounded-md border border-input bg-popover px-2 font-medium text-foreground text-xs">
              {copy.today}
            </span>
            <span
              title={copy.next}
              className="flex size-6 items-center justify-center rounded-md border border-input bg-popover text-foreground"
            >
              <ChevronRight aria-hidden className="size-3.5" />
            </span>
          </span>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid shrink-0 grid-cols-7 border-border border-b bg-background">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday}
              className="border-border/60 border-r px-1 py-2 text-center font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
            >
              {copy.weekdays[weekday]}
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {weekStarts.map((weekStart) => {
            const { segments, hidden } = packWeek(
              state.tasks,
              weekStart,
              maxLanes,
            );
            return (
              <div
                key={weekStart}
                className="relative grid min-h-0 flex-1 grid-cols-7 border-border/70 border-b"
                style={{
                  gridTemplateRows: `auto repeat(${maxLanes}, min-content) 1fr`,
                }}
              >
                {WEEKDAYS.map((weekday, index) => {
                  const day = weekStart + index;
                  return (
                    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only drop zone; bars stay usable without it.
                    <div
                      key={weekday}
                      data-demo={`cal-day-${day}`}
                      style={{ gridColumn: index + 1, gridRow: "1 / -1" }}
                      className={cn(
                        "relative min-w-0 border-border/60 border-r",
                        index >= 5 && "bg-(--weekend-tint)",
                        day === TODAY && "bg-(--today-tint)",
                      )}
                      onDragOver={(event) => {
                        if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                          event.preventDefault();
                        }
                      }}
                      onDrop={(event) => {
                        const id = event.dataTransfer.getData(DRAG_TYPE);
                        if (id) {
                          event.preventDefault();
                          dispatch({ type: "reschedule", id, day });
                        }
                      }}
                    />
                  );
                })}
                {WEEKDAYS.map((weekday, index) => {
                  const day = weekStart + index;
                  const date = dateOf(day);
                  return (
                    <div
                      key={`number-${weekday}`}
                      style={{ gridColumn: index + 1, gridRow: 1 }}
                      className="pointer-events-none z-10 flex justify-end px-1 py-1"
                    >
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full font-medium text-[11px]",
                          !isWeek &&
                            date.month !== "oct" &&
                            "text-muted-foreground/60",
                          day === TODAY &&
                            "bg-(--today) font-semibold text-background",
                        )}
                      >
                        {date.day}
                      </span>
                    </div>
                  );
                })}
                {segments.map((segment) => {
                  const task = segment.task;
                  const done = task.status === "done";
                  const overdue = !done && task.end < TODAY;
                  return (
                    <button
                      key={segment.task.id}
                      type="button"
                      draggable
                      data-demo={`cal-${segment.task.id}`}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(DRAG_TYPE, segment.task.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      data-tone={STATUS_HUE[task.status]}
                      data-overdue={overdue || undefined}
                      style={{
                        ...statusToneStyle(task.status),
                        gridColumn: `${segment.from + 1} / ${segment.to + 2}`,
                        gridRow: segment.lane + 2,
                      }}
                      title={task.title}
                      className={cn(
                        "z-10 mb-0.5 flex h-5 min-w-0 cursor-grab items-center gap-1 overflow-hidden border border-(color:--tone)/25 border-l-[3px] bg-(color:--tone-tint) px-1.5 text-left font-medium text-[11px] leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        overdue
                          ? "border-l-destructive"
                          : "border-l-(color:--tone)",
                        done
                          ? "text-muted-foreground line-through"
                          : "text-(color:--tone-fg)",
                        segment.continuesBefore
                          ? "rounded-l-none border-l-0"
                          : "ml-1 rounded-l-md",
                        segment.continuesAfter
                          ? "rounded-r-none border-r-0"
                          : "mr-1 rounded-r-md",
                      )}
                    >
                      {done ? (
                        <Check
                          aria-hidden
                          strokeWidth={3}
                          className="size-3 shrink-0 text-(color:--tone)"
                        />
                      ) : (
                        <PriorityDot priority={task.priority} />
                      )}
                      <span className="truncate">{task.title}</span>
                      {!compact && (
                        <AvatarStack
                          names={task.assignees}
                          max={2}
                          size="xs"
                          className="ms-auto ps-1"
                        />
                      )}
                    </button>
                  );
                })}
                {hidden.map((count, index) =>
                  count > 0 ? (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: one slot per weekday.
                      key={index}
                      style={{ gridColumn: index + 1, gridRow: maxLanes + 2 }}
                      className="z-10 px-1.5 text-[11px] text-muted-foreground"
                    >
                      +{count}
                    </span>
                  ) : null,
                )}
              </div>
            );
          })}
        </div>
      </div>
    </ViewFrame>
  );
}

/** The calendar scene, ready to drop into a page. */
export function CalendarViewDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createCalendarViewScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.viewCalendar.caption}
      description={copy.scenes.viewCalendar.description}
      size={VIEW_STAGE_SIZE}
      compactSize={VIEW_STAGE_COMPACT}
      className={className}
    />
  );
}
