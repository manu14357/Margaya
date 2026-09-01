"use client";

import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  IterationCw,
  ListFilter,
  Plus,
  Ruler,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  Avatar,
  BurnChart,
  EstimateChip,
  FilterBar,
  FilterChip,
  GroupProgressBar,
  IconRail,
  PropertyPopover,
  ReplicaButton,
  ReplicaShell,
  StatusIcon,
  TaskListGroup,
  TaskListRow,
  ToneBadge,
  TopBar,
} from "../../replica";
import { ProjectCrumb } from "../planning/crumb";
import {
  burnSeries,
  CYCLE_DAYS,
  type CyclesAction,
  type CyclesState,
  type CycleTask,
  type CycleTaskStatus,
  cycleCounts,
  cyclesReducer,
  pointTotals,
} from "./state";

type Demo = LandingCopy["demo"];

/** The task the script completes. */
export const COMPLETED_TASK_ID = "avatars";

const GROUPS: CycleTaskStatus[] = ["inProgress", "todo", "done"];

function initialTasks(demo: Demo): CycleTask[] {
  const { tasks } = demo.cycles;
  const { people } = demo;
  return [
    {
      id: "avatars",
      number: 27,
      title: tasks.avatars,
      status: "inProgress",
      priority: "medium",
      points: 2,
      assignees: [people.adam.name],
    },
    {
      id: "webhooks",
      number: 31,
      title: tasks.webhooks,
      status: "inProgress",
      priority: "high",
      points: 3,
      assignees: [people.jonas.name],
    },
    {
      id: "search",
      number: 29,
      title: tasks.search,
      status: "inProgress",
      priority: "low",
      points: 5,
      assignees: [people.sam.name, people.priya.name],
    },
    {
      id: "timezone",
      number: 33,
      title: tasks.timezone,
      status: "todo",
      priority: "urgent",
      points: 3,
      assignees: [people.mira.name],
    },
    {
      id: "invite",
      number: 34,
      title: tasks.invite,
      status: "todo",
      priority: "none",
      points: 1,
      assignees: [],
    },
    {
      id: "export",
      number: 15,
      title: tasks.export,
      status: "done",
      priority: "high",
      points: 5,
      assignees: [people.jonas.name],
    },
    {
      id: "redirect",
      number: 24,
      title: tasks.redirect,
      status: "done",
      priority: "high",
      points: 3,
      assignees: [people.adam.name],
    },
  ];
}

/**
 * The cycle page: the cycle's tasks by status beside its sidebar. The
 * burn-down draws itself, then the cursor marks a task done and the
 * progress, points and line all move.
 */
export function createCyclesScene(
  demo: Demo,
): DemoScene<CyclesState, CyclesAction> {
  return {
    id: "cycles",
    initialState: { tasks: initialTasks(demo), drawn: false, menuFor: null },
    reducer: cyclesReducer,
    script: [
      step.wait(500),
      step.set({ type: "draw" }),
      step.wait(1900),
      step.click(`status-${COMPLETED_TASK_ID}`, {
        type: "openStatus",
        id: COMPLETED_TASK_ID,
      }),
      step.wait(450),
      step.click("option-done", {
        type: "setStatus",
        id: COMPLETED_TASK_ID,
        status: "done",
      }),
      step.wait(3400),
    ],
    render: (props) => <CyclesView {...props} />,
  };
}

function CyclesView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<CyclesState, CyclesAction>) {
  const demo = useLandingCopy().demo;
  const { cycles, statuses, planning, shell } = demo;
  const counts = cycleCounts(state.tasks);

  const summary = (
    <CycleSummary
      state={state}
      demo={demo}
      chartWidth={compact ? 500 : 264}
      chartHeight={compact ? 120 : 150}
    />
  );

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail
            active="projects"
            user={demo.people.adam.name}
            inboxCount={3}
          />
        )
      }
    >
      <TopBar
        compact={compact}
        place={
          <ProjectCrumb project={demo.projects.website} icon={IterationCw}>
            {cycles.name}
          </ProjectCrumb>
        }
        actions={<ReplicaButton icon={Plus}>{cycles.addTasks}</ReplicaButton>}
      />
      <FilterBar
        trailing={
          <ReplicaButton icon={SlidersHorizontal}>
            {shell.display}
          </ReplicaButton>
        }
      >
        <FilterChip icon={ListFilter}>{shell.filter}</FilterChip>
        <span className="ms-1 text-muted-foreground text-xs tabular-nums">
          {fill(planning.doneOfScope, {
            done: counts.done,
            scope: counts.scope,
          })}
        </span>
      </FilterBar>
      <div className={cn("flex min-h-0 flex-1", compact && "flex-col")}>
        {compact && (
          <div className="shrink-0 border-border border-b bg-card p-4">
            {summary}
          </div>
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          {GROUPS.map((status) => {
            const tasks = state.tasks.filter((task) => task.status === status);
            const count = status === "done" ? counts.done : tasks.length;
            return (
              <div key={status}>
                <TaskListGroup
                  data-demo={`group-${status}`}
                  status={status}
                  title={statuses[status]}
                  count={count}
                />
                {tasks.map((task) => (
                  <TaskListRow
                    key={task.id}
                    id={task.id}
                    taskKey={`${demo.hero.projectKey}-${task.number}`}
                    title={task.title}
                    status={task.status}
                    priority={task.priority}
                    assignees={task.assignees}
                    statusLabel={statuses[task.status]}
                    onStatusClick={() =>
                      dispatch({ type: "openStatus", id: task.id })
                    }
                    className={state.menuFor === task.id ? "z-20" : undefined}
                    chips={
                      <EstimateChip>
                        {fill(planning.points, { value: task.points })}
                      </EstimateChip>
                    }
                  >
                    {state.menuFor === task.id && (
                      <PropertyPopover
                        className="absolute top-8 left-24"
                        options={(["todo", "inProgress", "done"] as const).map(
                          (id) => ({
                            id,
                            label: statuses[id],
                            icon: (
                              <StatusIcon
                                status={id}
                                colored
                                className="size-3.5"
                              />
                            ),
                            selected: id === task.status,
                          }),
                        )}
                        onSelect={(id) =>
                          dispatch({
                            type: "setStatus",
                            id: task.id,
                            status: id as CycleTaskStatus,
                          })
                        }
                      />
                    )}
                  </TaskListRow>
                ))}
              </div>
            );
          })}
        </div>
        {!compact && (
          <aside className="w-[300px] shrink-0 overflow-hidden border-border border-l bg-card p-4">
            {summary}
          </aside>
        )}
      </div>
    </ReplicaShell>
  );
}

function PropertyRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="w-16 shrink-0 text-muted-foreground text-xs">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

/** The cycle sidebar: badge, name, progress, points and the burn chart. */
function CycleSummary({
  state,
  demo,
  chartWidth,
  chartHeight,
}: {
  state: CyclesState;
  demo: Demo;
  chartWidth: number;
  chartHeight: number;
}) {
  const { cycles, planning } = demo;
  const counts = cycleCounts(state.tasks);
  const points = pointTotals(state.tasks);
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <ToneBadge tone="info">{cycles.badge}</ToneBadge>
        <h2 className="font-semibold text-base leading-snug">{cycles.name}</h2>
      </section>
      <section className="space-y-2" data-demo="cycle-progress">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium text-muted-foreground text-xs">
            {cycles.progress}
          </h3>
          <span className="font-semibold text-lg tabular-nums">
            {counts.percent}%
          </span>
        </div>
        <GroupProgressBar
          counts={{
            completed: counts.done,
            started: counts.started,
            unstarted: counts.unstarted,
            backlog: 0,
          }}
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Ruler aria-hidden className="size-3.5" />
            {planning.estimate}
          </span>
          <span className="font-medium tabular-nums">
            {fill(planning.pointsTotal, points)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-success transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${(points.completed / points.total) * 100}%` }}
          />
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex h-6 items-center rounded-md border border-input bg-background p-0.5 text-xs">
            <span className="rounded bg-accent px-2 py-0.5 font-medium text-foreground">
              {cycles.burndown}
            </span>
            <span className="px-2 py-0.5 text-muted-foreground">
              {cycles.burnup}
            </span>
          </span>
          <span className="font-medium text-xs">
            {fill(cycles.tasksLeft, { count: counts.remaining })}
          </span>
        </div>
        <div data-demo="burn-chart">
          <BurnChart
            remaining={burnSeries(state.tasks)}
            scope={counts.scope}
            days={CYCLE_DAYS}
            width={chartWidth}
            height={chartHeight}
            drawn={state.drawn}
            startLabel={cycles.start}
            endLabel={cycles.end}
            labels={{ actual: cycles.pending, reference: cycles.ideal }}
          />
        </div>
      </section>
      <section className="space-y-2">
        <PropertyRow icon={CalendarDays} label={cycles.dates}>
          {cycles.range}
        </PropertyRow>
        <PropertyRow icon={UserRound} label={cycles.owner}>
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={demo.people.mira.name} size="xs" />
            {demo.people.mira.name}
          </span>
        </PropertyRow>
      </section>
    </div>
  );
}

/** The cycles demo, ready to drop into a section. */
export function CyclesDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createCyclesScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.cycles.caption}
      description={copy.scenes.cycles.description}
      size={{ width: 960, height: 600 }}
      compactSize={{ width: 560, height: 700 }}
      className={className}
    />
  );
}
