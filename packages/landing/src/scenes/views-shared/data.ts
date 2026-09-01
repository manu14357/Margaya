import { fill, type LandingCopy } from "../../copy";
import type { LabelColor, Priority, StatusId } from "../../replica";

export type Demo = LandingCopy["demo"];

export type ViewTaskId =
  | "search"
  | "invoices"
  | "avatars"
  | "tokens"
  | "latency"
  | "release"
  | "a11y"
  | "sitemap"
  | "onboarding";

/**
 * One task of the Website project, shared by the view scenes. Dates are days
 * of October 2026 (0 is September 30, 32 is November 1); `end` is included.
 */
export type ViewTask = {
  id: ViewTaskId;
  number: number;
  title: string;
  status: StatusId;
  priority: Priority;
  labels: { name: string; color: LabelColor }[];
  assignees: string[];
  start: number;
  end: number;
};

/** Every view scene's design sizes, so switching tabs never shifts layout. */
export const VIEW_STAGE_SIZE = { width: 1280, height: 760 };
export const VIEW_STAGE_COMPACT = { width: 640, height: 760 };

/** "Today" in the replicas: Wednesday, October 14, 2026. */
export const TODAY = 14;

/** The board's and list's statuses, in workflow order. */
export const WORKFLOW: StatusId[] = ["todo", "inProgress", "inReview", "done"];

export function viewTasks(demo: Demo): ViewTask[] {
  const { tasks } = demo.views;
  const { people, labels } = demo;
  const task = (
    id: ViewTaskId,
    number: number,
    status: StatusId,
    priority: Priority,
    taskLabels: ViewTask["labels"],
    assignees: string[],
    start: number,
    end: number,
  ): ViewTask => ({
    id,
    number,
    title: tasks[id],
    status,
    priority,
    labels: taskLabels,
    assignees,
    start,
    end,
  });
  const bug = { name: labels.bug, color: "red" as const };
  const feature = { name: labels.feature, color: "purple" as const };
  const design = { name: labels.design, color: "pink" as const };
  const docs = { name: labels.docs, color: "teal" as const };
  return [
    task("search", 41, "todo", "high", [feature], [people.priya.name], 19, 23),
    task(
      "invoices",
      38,
      "todo",
      "medium",
      [feature],
      [people.jonas.name],
      20,
      21,
    ),
    task("avatars", 44, "todo", "low", [design], [people.mira.name], 22, 22),
    task(
      "tokens",
      35,
      "inProgress",
      "urgent",
      [bug],
      [people.sam.name],
      12,
      14,
    ),
    task(
      "latency",
      33,
      "inProgress",
      "medium",
      [],
      [people.adam.name, people.jonas.name],
      13,
      16,
    ),
    task(
      "release",
      39,
      "inReview",
      "medium",
      [docs],
      [people.mira.name],
      15,
      16,
    ),
    task(
      "a11y",
      36,
      "inReview",
      "high",
      [bug, design],
      [people.priya.name],
      14,
      14,
    ),
    task("sitemap", 29, "done", "low", [], [people.sam.name], 9, 9),
    task("onboarding", 27, "done", "medium", [docs], [people.adam.name], 7, 8),
  ];
}

export function taskKeyOf(demo: Demo, task: { number: number }): string {
  return `${demo.views.projectKey}-${task.number}`;
}

/** A day number (see `ViewTask`) as its date in the month it falls in. */
export function dateOf(day: number): {
  month: "sep" | "oct" | "nov";
  day: number;
} {
  if (day <= 0) return { month: "sep", day: 30 + day };
  if (day > 31) return { month: "nov", day: day - 31 };
  return { month: "oct", day };
}

/** "Oct 14", from `landing.demo.views.date`. */
export function formatDay(demo: Demo, day: number): string {
  const date = dateOf(day);
  return fill(demo.views.date, {
    month: demo.views.months[date.month],
    day: date.day,
  });
}

/** The due chip's tone, as the app colours it. */
export function dueTone(task: ViewTask): "muted" | "soon" | "overdue" {
  if (task.status === "done") return "muted";
  if (task.end < TODAY) return "overdue";
  return task.end - TODAY <= 2 ? "soon" : "muted";
}

/** Moves a task to the top of another status, like a drop on a column. */
export function moveToStatus<T extends { id: string; status: StatusId }>(
  tasks: readonly T[],
  id: string,
  status: StatusId,
): T[] {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) return [...tasks];
  const rest = tasks.filter((candidate) => candidate.id !== id);
  const index = rest.findIndex((candidate) => candidate.status === status);
  const moved = { ...task, status };
  if (index === -1) return [...rest, moved];
  return [...rest.slice(0, index), moved, ...rest.slice(index)];
}
