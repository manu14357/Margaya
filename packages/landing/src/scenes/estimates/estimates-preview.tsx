"use client";

import { Ruler } from "lucide-react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import { cn } from "../../lib/cn";
import {
  EstimateChip,
  type Priority,
  type StatusId,
  TaskListRow,
  ToneBadge,
} from "../../replica";

type Demo = LandingCopy["demo"];

export const POINT_VALUES = [1, 2, 3, 5, 8, 13] as const;

type EstimatedTask = {
  id: keyof Demo["estimates"]["tasks"];
  number: number;
  status: StatusId;
  priority: Priority;
  points: (typeof POINT_VALUES)[number];
  assignee: keyof Demo["people"];
};

export const ESTIMATED_TASKS: readonly EstimatedTask[] = [
  {
    id: "redirect",
    number: 24,
    status: "done",
    priority: "high",
    points: 5,
    assignee: "adam",
  },
  {
    id: "export",
    number: 15,
    status: "done",
    priority: "high",
    points: 8,
    assignee: "jonas",
  },
  {
    id: "webhooks",
    number: 31,
    status: "inProgress",
    priority: "medium",
    points: 8,
    assignee: "jonas",
  },
  {
    id: "invite",
    number: 34,
    status: "todo",
    priority: "low",
    points: 5,
    assignee: "priya",
  },
];

/** Completed and total points of the preview's tasks. */
export function estimateTotals(tasks: readonly EstimatedTask[]) {
  return {
    completed: tasks
      .filter((task) => task.status === "done")
      .reduce((sum, task) => sum + task.points, 0),
    total: tasks.reduce((sum, task) => sum + task.points, 0),
  };
}

/**
 * A still replica of estimates: the project's points system with its
 * values, tasks carrying point chips, and the done / total summary.
 */
export function EstimatesPreview({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const demo = copy.demo;
  const { estimates, planning } = demo;
  const totals = estimateTotals(ESTIMATED_TASKS);
  return (
    <figure className={cn("m-0 w-full", className)}>
      <p className="sr-only">{copy.scenes.estimates.description}</p>
      <div
        aria-hidden
        className="overflow-hidden rounded-xl border border-border bg-background font-sans text-foreground text-sm shadow-black/5 shadow-xl dark:shadow-black/30"
      >
        <div className="space-y-3 border-border border-b bg-card p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
              <Ruler className="size-4 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-sm">
                  {estimates.system}
                </span>
                <ToneBadge tone="success">{estimates.active}</ToneBadge>
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                {estimates.systemHint}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="me-1 text-muted-foreground text-xs">
              {estimates.values}
            </span>
            {POINT_VALUES.map((value) => (
              <span
                key={value}
                className="inline-flex h-6 min-w-7 items-center justify-center rounded-md border border-border bg-background px-1.5 font-medium text-xs tabular-nums"
              >
                {value}
              </span>
            ))}
          </div>
        </div>
        <div>
          {ESTIMATED_TASKS.map((task) => (
            <TaskListRow
              key={task.id}
              id={`estimate-${task.id}`}
              taskKey={`${demo.hero.projectKey}-${task.number}`}
              title={estimates.tasks[task.id]}
              status={task.status}
              priority={task.priority}
              assignees={[demo.people[task.assignee].name]}
              chips={
                <EstimateChip>
                  {fill(planning.points, { value: task.points })}
                </EstimateChip>
              }
            />
          ))}
        </div>
        <div className="space-y-1.5 p-4">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Ruler className="size-3.5" />
              {planning.estimate}
            </span>
            <span className="font-medium tabular-nums">
              {fill(planning.pointsTotal, totals)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success"
              style={{ width: `${(totals.completed / totals.total) * 100}%` }}
            />
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-muted-foreground text-sm">
        {copy.scenes.estimates.caption}
      </figcaption>
    </figure>
  );
}
