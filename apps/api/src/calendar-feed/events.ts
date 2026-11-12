import { shiftDate } from "../utils/calendar-date";
import { localDateString } from "../utils/zoned-date";
import type { IcsEvent } from "./ics";

// Turns tasks and cycles into all-day calendar events. Pure, so the feed's
// shape is unit tested without a database.

/** Days before today a feed still lists, so recent history stays visible. */
export const FEED_PAST_DAYS = 90;
/** Days after today a feed lists. */
export const FEED_FUTURE_DAYS = 365;
/** The most events one feed carries; the earliest are kept. */
export const FEED_MAX_EVENTS = 2000;

const SEQUENCE_EPOCH_MS = Date.UTC(2020, 0, 1);
const MAX_INTEGER = 2_147_483_647;

export type FeedTask = {
  id: string;
  title: string;
  number: number | null;
  projectId: string;
  projectSlug: string;
  projectName: string;
  startDate: Date | null;
  dueDate: Date | null;
  isMilestone: boolean;
  completedAt: Date | null;
  updatedAt: Date;
};

export type FeedCycle = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  updatedAt: Date;
};

export type FeedContext = {
  workspaceId: string;
  /** IANA zone that turns stored instants into calendar days. */
  timezone: string;
  /** Today in that zone, "YYYY-MM-DD". */
  today: string;
  /** The web app's public URL, without a trailing slash. */
  webUrl: string;
  /** Workspace-wide feeds name each item's project in its summary. */
  showProject: boolean;
};

/**
 * SEQUENCE must grow with every change (5545 3.8.7.4) and fit a signed
 * 32-bit integer: whole seconds since 2020, which lasts until 2088.
 */
export function sequenceOf(updatedAt: Date): number {
  const seconds = Math.floor((updatedAt.getTime() - SEQUENCE_EPOCH_MS) / 1000);
  return Math.min(MAX_INTEGER, Math.max(0, seconds));
}

/** The first and last day a feed lists, inclusive. */
export function feedWindow(today: string) {
  return {
    first: shiftDate(today, -FEED_PAST_DAYS),
    last: shiftDate(today, FEED_FUTURE_DAYS),
  };
}

function inWindow(first: string, last: string, today: string) {
  const window = feedWindow(today);
  return last >= window.first && first <= window.last;
}

export function taskUrl(ctx: FeedContext, task: FeedTask) {
  return `${ctx.webUrl}/dashboard/workspace/${ctx.workspaceId}/project/${task.projectId}/task/${task.id}`;
}

/**
 * One all-day event from the start date to the due date (either alone is a
 * single day), or null for a task without dates or outside the window.
 * Dates have no time of day in Margaya, so the stored instant is read as a
 * calendar day in the feed's zone.
 */
export function taskEvent(task: FeedTask, ctx: FeedContext): IcsEvent | null {
  const start = task.startDate
    ? localDateString(task.startDate, ctx.timezone)
    : null;
  const due = task.dueDate ? localDateString(task.dueDate, ctx.timezone) : null;
  const a = start ?? due;
  const b = due ?? start;
  if (!a || !b) return null;
  // A milestone marks one date: its due date when it has one.
  const first = task.isMilestone ? b : a < b ? a : b;
  const last = task.isMilestone ? b : a < b ? b : a;
  if (!inWindow(first, last, ctx.today)) return null;

  const marks = `${task.completedAt ? "✓ " : ""}${task.isMilestone ? "◆ " : ""}`;
  const key =
    task.number === null
      ? task.projectSlug
      : `${task.projectSlug}-${task.number}`;
  const url = taskUrl(ctx, task);
  return {
    uid: `task-${task.id}@margaya`,
    startDate: first,
    endDate: shiftDate(last, 1),
    summary: `${marks}${task.title}${ctx.showProject ? ` · ${task.projectName}` : ""}`,
    description: `${key} · ${task.projectName}\n${url}`,
    url,
    categories: [task.projectName],
    lastModified: task.updatedAt,
    sequence: sequenceOf(task.updatedAt),
  };
}

/** A cycle's whole date range as one all-day event, or null outside the window. */
export function cycleEvent(
  cycle: FeedCycle,
  ctx: FeedContext,
): IcsEvent | null {
  const first =
    cycle.startDate <= cycle.endDate ? cycle.startDate : cycle.endDate;
  const last =
    cycle.startDate <= cycle.endDate ? cycle.endDate : cycle.startDate;
  if (!inWindow(first, last, ctx.today)) return null;
  const url = `${ctx.webUrl}/dashboard/workspace/${ctx.workspaceId}/project/${cycle.projectId}/cycles/${cycle.id}`;
  return {
    uid: `cycle-${cycle.id}@margaya`,
    startDate: first,
    endDate: shiftDate(last, 1),
    summary: `↻ ${cycle.name}${ctx.showProject ? ` · ${cycle.projectName}` : ""}`,
    description: `${cycle.projectName}\n${url}`,
    url,
    categories: [cycle.projectName],
    lastModified: cycle.updatedAt,
    sequence: sequenceOf(cycle.updatedAt),
  };
}

/** Every event of a feed, earliest first, capped at FEED_MAX_EVENTS. */
export function feedEvents(
  tasks: FeedTask[],
  cycles: FeedCycle[],
  ctx: FeedContext,
): IcsEvent[] {
  const events: IcsEvent[] = [];
  for (const cycle of cycles) {
    const event = cycleEvent(cycle, ctx);
    if (event) events.push(event);
  }
  for (const task of tasks) {
    const event = taskEvent(task, ctx);
    if (event) events.push(event);
  }
  events.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) || a.uid.localeCompare(b.uid),
  );
  return events.slice(0, FEED_MAX_EVENTS);
}
