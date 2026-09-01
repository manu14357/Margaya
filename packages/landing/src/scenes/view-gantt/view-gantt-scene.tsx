"use client";

import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useId, useMemo } from "react";
import { fill, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import { AvatarStack, ViewChoice } from "../../replica";
import {
  type Demo,
  dateOf,
  formatDay,
  TODAY,
  taskKeyOf,
  VIEW_STAGE_COMPACT,
  VIEW_STAGE_SIZE,
  type ViewTask,
  viewTasks,
} from "../views-shared/data";
import { ViewFrame } from "../views-shared/frame";
import {
  barBox,
  DAY_WIDTH,
  dependencyPath,
  GANTT_ROWS,
  type GanttViewAction,
  type GanttViewState,
  type GanttZoom,
  ganttViewReducer,
  isConflict,
  RANGE_DAYS,
  RANGE_START,
  RELATION,
  ROW_HEIGHT,
} from "./state";

/**
 * The Gantt chart: zoom Week → Month, the blocking line draws in, then the
 * blocker's end is dragged two days later and the line turns red.
 */
export function createGanttViewScene(
  demo: Demo,
): DemoScene<GanttViewState, GanttViewAction> {
  const rows: readonly string[] = GANTT_ROWS;
  const tasks = viewTasks(demo)
    .filter((task) => rows.includes(task.id))
    .sort((a, b) => rows.indexOf(a.id) - rows.indexOf(b.id));
  // Aim at the middle of the blocker's row, near the day's right edge.
  const rowAnchor = {
    x: 0.82,
    y: (rows.indexOf(RELATION.source) + 0.5) / rows.length,
  };
  return {
    id: "viewGantt",
    initialState: { tasks, zoom: "week", linked: false },
    reducer: ganttViewReducer,
    script: [
      step.wait(700),
      step.click("zoom-month", { type: "zoom", zoom: "month" }),
      step.wait(500),
      step.set({ type: "link" }),
      step.wait(1100),
      step.drag(
        `bar-end-${RELATION.source}`,
        "gantt-col-16",
        { type: "resize", id: RELATION.source, end: 16 },
        { anchor: rowAnchor },
      ),
      step.wait(2600),
    ],
    render: (props) => <GanttView {...props} />,
  };
}

function GanttView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<GanttViewState, GanttViewAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.viewGantt;
  const markerId = `gantt-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const dayWidth = DAY_WIDTH[state.zoom];
  const rail = compact ? 184 : 320;
  const days = Array.from(
    { length: RANGE_DAYS },
    (_, index) => RANGE_START + index,
  );
  const source = state.tasks.find((task) => task.id === RELATION.source);
  const target = state.tasks.find((task) => task.id === RELATION.target);
  const conflict = !!source && !!target && isConflict(source, target);
  const rowOf = (id: string) => state.tasks.findIndex((task) => task.id === id);
  const path =
    source && target
      ? dependencyPath(
          {
            right: barBox(source, dayWidth).right,
            centerY: (rowOf(source.id) + 0.5) * ROW_HEIGHT,
          },
          {
            left: barBox(target, dayWidth).left,
            centerY: (rowOf(target.id) + 0.5) * ROW_HEIGHT,
          },
        )
      : "";
  const periodEnd =
    state.zoom === "week"
      ? copy.periodEndWeek
      : state.zoom === "month"
        ? copy.periodEndMonth
        : copy.periodEndQuarter;

  return (
    <ViewFrame view="gantt" compact={compact} taskCount={9}>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center gap-1.5 border-border/80 border-b px-3 py-1.5">
          <span className="flex h-7 w-56 min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-muted-foreground text-xs dark:bg-input/32">
            <Search aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{copy.search}</span>
          </span>
          <span className="ms-auto flex items-center gap-1.5">
            <ViewChoice<GanttZoom>
              label={copy.zoomLabel}
              value={state.zoom}
              demoPrefix="zoom"
              onChange={(zoom) => dispatch({ type: "zoom", zoom })}
              options={[
                { value: "week", label: copy.week },
                { value: "month", label: copy.month },
                { value: "quarter", label: copy.quarter },
              ]}
            />
            {!compact && (
              <>
                <OutlineIcon icon={ChevronLeft} />
                <span className="flex h-7 items-center rounded-md border border-border bg-background px-2 text-foreground text-xs">
                  {copy.periodStart}
                </span>
                <span className="text-muted-foreground text-xs">
                  {periodEnd}
                </span>
                <OutlineIcon icon={ChevronRight} />
                <span className="flex h-6 items-center gap-1 rounded-md border border-input bg-popover px-2 font-medium text-foreground text-xs">
                  <Calendar aria-hidden className="size-3.5" />
                  {copy.today}
                </span>
              </>
            )}
          </span>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className="relative"
            style={{ width: rail + RANGE_DAYS * dayWidth }}
          >
            <div className="flex border-border border-b bg-background">
              <div
                className="shrink-0 border-border border-r bg-background px-4 py-3"
                style={{ width: rail }}
              >
                <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                  {copy.taskHeader}
                </p>
              </div>
              {days.map((day, index) => (
                <DayHeader
                  key={day}
                  day={day}
                  index={index}
                  width={dayWidth}
                  zoom={state.zoom}
                />
              ))}
            </div>

            <div className="relative">
              <div
                aria-hidden
                className="absolute inset-y-0 z-0 flex"
                style={{ left: rail }}
              >
                {days.map((day, index) => (
                  <div
                    key={day}
                    data-demo={`gantt-col-${day}`}
                    className={cn(
                      "h-full shrink-0 border-border/60 border-r",
                      index % 7 >= 5 && "bg-muted/25",
                    )}
                    style={{ width: dayWidth }}
                  />
                ))}
              </div>

              <svg
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute top-0 z-[15] overflow-visible",
                  conflict ? "text-destructive" : "text-muted-foreground",
                )}
                style={{
                  left: rail,
                  width: RANGE_DAYS * dayWidth,
                  height: state.tasks.length * ROW_HEIGHT,
                }}
              >
                <defs>
                  <marker
                    id={markerId}
                    viewBox="0 0 6 6"
                    refX="5"
                    refY="3"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 6 3 L 0 6 z" fill="currentColor" />
                  </marker>
                </defs>
                {path && (
                  <path
                    data-demo="dependency-line"
                    data-conflict={conflict || undefined}
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={conflict ? 1.75 : 1.25}
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray="1"
                    markerEnd={state.linked ? `url(#${markerId})` : undefined}
                    style={{
                      strokeDashoffset: state.linked ? 0 : 1,
                      transition: "stroke-dashoffset 800ms ease-out",
                    }}
                  />
                )}
              </svg>

              <div className="relative z-10 flex flex-col">
                {state.tasks.map((task) => (
                  <GanttRow
                    key={task.id}
                    task={task}
                    rail={rail}
                    dayWidth={dayWidth}
                    flagged={
                      state.linked && conflict && task.id === RELATION.target
                    }
                    conflictLabel={copy.conflict}
                    taskKey={taskKeyOf(demo, task)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ViewFrame>
  );
}

function OutlineIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-6 items-center justify-center rounded-md border border-input bg-popover text-foreground">
      <Icon aria-hidden className="size-4" />
    </span>
  );
}

function DayHeader({
  day,
  index,
  width,
  zoom,
}: {
  day: number;
  index: number;
  width: number;
  zoom: GanttZoom;
}) {
  const demo = useLandingCopy().demo;
  const date = dateOf(day);
  const monday = index % 7 === 0;
  const label =
    index === 0 || date.day === 1
      ? demo.views.months[date.month]
      : monday
        ? formatDay(demo, day)
        : "";
  const everyDay = zoom !== "quarter";
  return (
    <div
      className={cn(
        "shrink-0 border-border/70 border-r px-0.5 py-2 text-center",
        index % 7 >= 5 && "bg-muted/25",
      )}
      style={{ width }}
    >
      <div className="h-4 whitespace-nowrap font-medium text-[10px] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mx-auto flex items-center justify-center rounded-full font-medium",
          everyDay ? "size-6 text-xs" : "size-4 text-[10px]",
          day === TODAY && "bg-primary text-primary-foreground",
        )}
      >
        {everyDay || monday || index === 0 || day === TODAY ? date.day : ""}
      </div>
    </div>
  );
}

function GanttRow({
  task,
  rail,
  dayWidth,
  flagged,
  conflictLabel,
  taskKey,
}: {
  task: ViewTask;
  rail: number;
  dayWidth: number;
  flagged: boolean;
  conflictLabel: string;
  taskKey: string;
}) {
  const demo = useLandingCopy().demo;
  const box = barBox(task, dayWidth);
  return (
    <div
      data-demo={`gantt-row-${task.id}`}
      className="flex border-border/70 border-b"
      style={{ height: ROW_HEIGHT }}
    >
      <div
        className="flex shrink-0 flex-col items-start justify-center gap-0.5 border-border border-r bg-background px-3"
        style={{ width: rail }}
      >
        <div className="flex w-full items-center gap-1.5">
          <span className="truncate rounded-full bg-secondary px-1.5 py-px font-medium text-[10px] text-secondary-foreground uppercase tracking-wide">
            {demo.statuses[task.status]}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">
            {taskKey}
          </span>
        </div>
        <p className="flex w-full min-w-0 items-center gap-1 font-medium text-foreground text-xs leading-tight">
          {flagged && (
            <TriangleAlert
              role="img"
              aria-label={conflictLabel}
              className="size-3 shrink-0 text-destructive"
            />
          )}
          <span className="truncate">{task.title}</span>
        </p>
        <p className="w-full truncate text-[11px] text-muted-foreground leading-tight">
          {fill(demo.viewGantt.range, {
            start: formatDay(demo, task.start),
            end: formatDay(demo, task.end),
          })}
          {` • ${task.assignees.join(", ")}`}
        </p>
      </div>
      <div className="relative min-w-0 flex-1">
        {box.right > 0 && (
          <div
            data-demo={`bar-${task.id}`}
            className="group absolute top-1.5 bottom-1.5 flex min-w-0 items-stretch overflow-hidden rounded-md border border-primary/25 bg-background font-medium text-foreground text-sm leading-none shadow-sm"
            style={{ left: box.left, width: box.right - box.left }}
          >
            <span className="w-2 shrink-0 border-primary/15 border-r bg-primary/8" />
            <span className="relative flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
              <span aria-hidden className="absolute inset-0 bg-primary/12" />
              <span className="relative min-w-0 flex-1 truncate">
                {task.title}
              </span>
              <AvatarStack
                names={task.assignees}
                max={2}
                size="xs"
                className="relative"
              />
            </span>
            <span
              data-demo={`bar-end-${task.id}`}
              data-demo-cursor="grab"
              className="w-2 shrink-0 cursor-ew-resize border-primary/15 border-l bg-primary/8"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** The Gantt scene, ready to drop into a page. */
export function GanttViewDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createGanttViewScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.viewGantt.caption}
      description={copy.scenes.viewGantt.description}
      size={VIEW_STAGE_SIZE}
      compactSize={VIEW_STAGE_COMPACT}
      className={className}
    />
  );
}
