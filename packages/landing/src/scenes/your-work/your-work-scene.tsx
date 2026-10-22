"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bell,
  LayoutDashboard,
  ListFilter,
  PenLine,
  SlidersHorizontal,
  UserRoundCheck,
} from "lucide-react";
import { useMemo } from "react";
import { type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  DueChip,
  FilterBar,
  FilterChip,
  IconRail,
  type Priority,
  ReplicaButton,
  ReplicaShell,
  type StatusId,
  TaskListRow,
  TopBar,
} from "../../replica";
import {
  YOUR_WORK_TABS,
  type YourWorkAction,
  type YourWorkState,
  type YourWorkTab,
  yourWorkReducer,
} from "./state";

type Demo = LandingCopy["demo"];
type TaskId = keyof Demo["yourWork"]["tasks"];
type DueId = keyof Demo["yourWork"]["due"];

type WorkTask = {
  id: TaskId;
  number: number;
  status: StatusId;
  priority: Priority;
  due?: DueId;
  assignee: keyof Demo["people"];
};

const DUE_TONE: Record<DueId, "muted" | "soon" | "overdue"> = {
  overdue: "overdue",
  today: "soon",
  tomorrow: "soon",
  later: "muted",
};

/** Each tab's tasks, across projects. */
export const TAB_TASKS: Record<YourWorkTab, readonly WorkTask[]> = {
  assigned: [
    {
      id: "redirect",
      number: 24,
      status: "inProgress",
      priority: "high",
      due: "overdue",
      assignee: "adam",
    },
    {
      id: "webhooks",
      number: 31,
      status: "todo",
      priority: "medium",
      due: "today",
      assignee: "adam",
    },
    {
      id: "export",
      number: 15,
      status: "inReview",
      priority: "high",
      due: "tomorrow",
      assignee: "adam",
    },
    {
      id: "onboarding",
      number: 18,
      status: "todo",
      priority: "low",
      due: "later",
      assignee: "adam",
    },
    {
      id: "demo",
      number: 44,
      status: "backlog",
      priority: "none",
      assignee: "adam",
    },
  ],
  created: [
    {
      id: "release",
      number: 42,
      status: "inProgress",
      priority: "medium",
      due: "tomorrow",
      assignee: "mira",
    },
    {
      id: "invoices",
      number: 39,
      status: "todo",
      priority: "high",
      due: "later",
      assignee: "priya",
    },
    {
      id: "weeks",
      number: 41,
      status: "backlog",
      priority: "none",
      assignee: "sam",
    },
    {
      id: "shortcuts",
      number: 45,
      status: "inReview",
      priority: "low",
      due: "today",
      assignee: "mira",
    },
  ],
  subscribed: [
    {
      id: "roles",
      number: 36,
      status: "todo",
      priority: "urgent",
      due: "later",
      assignee: "jonas",
    },
    {
      id: "cache",
      number: 19,
      status: "inProgress",
      priority: "medium",
      assignee: "sam",
    },
    {
      id: "retention",
      number: 47,
      status: "todo",
      priority: "high",
      due: "tomorrow",
      assignee: "jonas",
    },
    {
      id: "contrast",
      number: 21,
      status: "done",
      priority: "low",
      assignee: "priya",
    },
  ],
};

const TAB_ICONS: Record<YourWorkTab | "summary", LucideIcon> = {
  summary: LayoutDashboard,
  assigned: UserRoundCheck,
  created: PenLine,
  subscribed: Bell,
};

/** Your work: the cursor walks the Assigned, Created and Subscribed tabs. */
export function createYourWorkScene(): DemoScene<
  YourWorkState,
  YourWorkAction
> {
  return {
    id: "yourWork",
    initialState: { tab: "assigned" },
    reducer: yourWorkReducer,
    script: [
      step.wait(1400),
      step.click("tab-created", { type: "tab", tab: "created" }),
      step.wait(1700),
      step.click("tab-subscribed", { type: "tab", tab: "subscribed" }),
      step.wait(3000),
    ],
    render: (props) => <YourWorkView {...props} />,
  };
}

function YourWorkView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<YourWorkState, YourWorkAction>) {
  const demo = useLandingCopy().demo;
  const { yourWork, shell, statuses } = demo;
  const tasks = TAB_TASKS[state.tab];
  const tabs = compact
    ? YOUR_WORK_TABS
    : (["summary", ...YOUR_WORK_TABS] as const);

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail
            active="myWork"
            user={demo.people.adam.name}
            inboxCount={3}
          />
        )
      }
    >
      <TopBar
        compact={compact}
        place={
          <>
            <UserRoundCheck
              aria-hidden
              className="size-4 text-muted-foreground"
            />
            <span>{yourWork.title}</span>
          </>
        }
      />
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-border/80 border-b bg-background px-3">
        {tabs.map((id) => {
          const Icon = TAB_ICONS[id];
          const active = id === state.tab;
          return (
            <span key={id} className="relative flex h-10 shrink-0 items-center">
              <button
                type="button"
                data-demo={`tab-${id}`}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (id !== "summary") dispatch({ type: "tab", tab: id });
                }}
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 font-medium text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon aria-hidden className="size-3.5" />
                {yourWork.tabs[id]}
              </button>
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary"
                />
              )}
            </span>
          );
        })}
      </div>
      <FilterBar
        trailing={
          <ReplicaButton icon={SlidersHorizontal}>
            {shell.display}
          </ReplicaButton>
        }
      >
        <FilterChip icon={ListFilter}>{shell.filter}</FilterChip>
      </FilterBar>
      <div
        key={state.tab}
        className="min-h-0 flex-1 overflow-hidden transition-opacity duration-300 starting:opacity-0"
        data-demo={`list-${state.tab}`}
      >
        {tasks.map((task) => (
          <TaskListRow
            key={task.id}
            id={task.id}
            taskKey={`${demo.hero.projectKey}-${task.number}`}
            title={yourWork.tasks[task.id]}
            status={task.status}
            statusLabel={statuses[task.status]}
            priority={task.priority}
            assignees={[demo.people[task.assignee].name]}
            chips={
              task.due ? (
                <DueChip
                  label={yourWork.due[task.due]}
                  tone={DUE_TONE[task.due]}
                />
              ) : undefined
            }
          />
        ))}
      </div>
    </ReplicaShell>
  );
}

/** The Your work demo, ready to drop into a section. */
export function YourWorkDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createYourWorkScene(), []);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.yourWork.caption}
      description={copy.scenes.yourWork.description}
      size={{ width: 800, height: 560 }}
      compactSize={{ width: 480, height: 560 }}
      className={className}
    />
  );
}
