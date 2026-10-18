import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { ColumnGroup } from "../column/groups";
import { activityTable, columnTable, taskTable } from "../database/schema";
import type { Reader } from "../task/progress-queries";
import { liveTaskCondition, taskColumnJoin, taskGroupSql } from "../task/scope";
import { listDays } from "../utils/calendar-date";
import {
  localDateString,
  startOfLocalDayUtc,
  startOfNextLocalDayUtc,
} from "../utils/zoned-date";
import {
  cycleTimeDays,
  rebuildTaskFlow,
  type StatusEvent,
  type TaskFlow,
} from "./flow-intervals";
import type { CycleTimeStats } from "./risk-signals";
import { percentile } from "./stats";

// The project's flow history, read for the forecast (throughput), the risk
// radar (cycle time, current stints) and flow alerts (all three). Counts and
// timestamps only; no task content.

export const CYCLE_TIME_LOOKBACK_DAYS = 90;
export const CYCLE_TIME_SAMPLE_LIMIT = 500;
export const FLOW_TASK_LIMIT = 5000;

/** Tasks completed per local day from `fromDay` to `toDay`, zeros included. */
export async function dailyThroughput(
  reader: Reader,
  projectId: string,
  fromDay: string,
  toDay: string,
  timeZone: string,
): Promise<number[]> {
  const days = listDays(fromDay, toDay);
  if (days.length === 0) return [];
  const rows = await reader
    .select({ completedAt: taskTable.completedAt })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        liveTaskCondition,
        sql`${taskGroupSql} = 'completed'`,
        gte(taskTable.completedAt, startOfLocalDayUtc(fromDay, timeZone)),
        lt(taskTable.completedAt, startOfNextLocalDayUtc(toDay, timeZone)),
      ),
    );
  const index = new Map(days.map((day, position) => [day, position]));
  const counts = days.map(() => 0);
  for (const row of rows) {
    if (!row.completedAt) continue;
    const position = index.get(localDateString(row.completedAt, timeZone));
    if (position !== undefined) counts[position] = (counts[position] ?? 0) + 1;
  }
  return counts;
}

/** Column slug → group for the project. */
export async function projectGroups(
  reader: Reader,
  projectId: string,
): Promise<(slug: string) => ColumnGroup | null> {
  const rows = await reader
    .select({ slug: columnTable.slug, group: columnTable.group })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId));
  const groups = new Map(rows.map((row) => [row.slug, row.group]));
  return (slug) =>
    slug === "planned" ? "backlog" : (groups.get(slug) ?? null);
}

function statusEvent(row: {
  createdAt: Date;
  eventData: unknown;
}): StatusEvent | null {
  const data = row.eventData as Record<string, unknown> | null;
  const oldStatus = data?.oldStatus;
  const newStatus = data?.newStatus;
  if (typeof oldStatus !== "string" || typeof newStatus !== "string") {
    return null;
  }
  return { at: row.createdAt, oldStatus, newStatus };
}

/** Status histories of the given tasks, oldest event first. */
export async function statusEventsByTask(
  reader: Reader,
  taskIds: readonly string[],
): Promise<Map<string, StatusEvent[]>> {
  const events = new Map<string, StatusEvent[]>();
  if (taskIds.length === 0) return events;
  const rows = await reader
    .select({
      taskId: activityTable.taskId,
      createdAt: activityTable.createdAt,
      eventData: activityTable.eventData,
    })
    .from(activityTable)
    .where(
      and(
        inArray(activityTable.taskId, [...taskIds]),
        eq(activityTable.type, "status_changed"),
      ),
    )
    .orderBy(asc(activityTable.createdAt), asc(activityTable.id));
  for (const row of rows) {
    const event = statusEvent(row);
    if (!event) continue;
    const list = events.get(row.taskId) ?? [];
    list.push(event);
    events.set(row.taskId, list);
  }
  return events;
}

export type FlowTask = {
  id: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  group: ColumnGroup;
  flow: TaskFlow;
};

/** Tasks with their rebuilt in-progress stints. */
export async function loadTaskFlows(
  reader: Reader,
  projectId: string,
  tasks: ReadonlyArray<{
    id: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    group: ColumnGroup;
  }>,
  groupOf?: (slug: string) => ColumnGroup | null,
): Promise<FlowTask[]> {
  const lookup = groupOf ?? (await projectGroups(reader, projectId));
  const events = await statusEventsByTask(
    reader,
    tasks.map((task) => task.id),
  );
  return tasks.map((task) => ({
    ...task,
    flow: rebuildTaskFlow(
      {
        createdAt: task.createdAt,
        status: task.status,
        events: events.get(task.id) ?? [],
      },
      lookup,
    ),
  }));
}

const flowTaskColumns = {
  id: taskTable.id,
  status: taskTable.status,
  createdAt: taskTable.createdAt,
  completedAt: taskTable.completedAt,
  group: taskGroupSql,
};

/** Cycle-time samples (days) of tasks completed since `since`, newest first. */
export async function cycleTimeSamples(
  reader: Reader,
  projectId: string,
  since: Date,
): Promise<number[]> {
  const completed = await reader
    .select(flowTaskColumns)
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        liveTaskCondition,
        sql`${taskGroupSql} = 'completed'`,
        gte(taskTable.completedAt, since),
      ),
    )
    .orderBy(desc(taskTable.completedAt))
    .limit(CYCLE_TIME_SAMPLE_LIMIT);
  const flows = await loadTaskFlows(reader, projectId, completed);
  return flows
    .map((task) =>
      task.completedAt ? cycleTimeDays(task.flow, task.completedAt) : null,
    )
    .filter((days): days is number => days !== null);
}

/** p50 and p85 cycle time over the recent completions. */
export async function cycleTimeStats(
  reader: Reader,
  projectId: string,
  now: Date,
): Promise<CycleTimeStats> {
  const since = new Date(now.getTime() - CYCLE_TIME_LOOKBACK_DAYS * 86_400_000);
  const samples = await cycleTimeSamples(reader, projectId, since);
  const round = (value: number | null) =>
    value === null ? null : Math.round(value * 10) / 10;
  return {
    samples: samples.length,
    p50Days: round(percentile(samples, 50)),
    p85Days: round(percentile(samples, 85)),
  };
}

/**
 * Every task that may have been in progress since `since`: started now,
 * completed since, or with a status change since. At most FLOW_TASK_LIMIT.
 */
export async function flowTasksSince(
  reader: Reader,
  projectId: string,
  since: Date,
): Promise<FlowTask[]> {
  const changed = reader
    .select({ id: activityTable.taskId })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .where(
      and(
        eq(taskTable.projectId, projectId),
        eq(activityTable.type, "status_changed"),
        gte(activityTable.createdAt, since),
      ),
    );
  const rows = await reader
    .select(flowTaskColumns)
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        liveTaskCondition,
        or(
          sql`${taskGroupSql} = 'started'`,
          gte(taskTable.completedAt, since),
          inArray(taskTable.id, changed),
        ),
      ),
    )
    .orderBy(desc(taskTable.updatedAt))
    .limit(FLOW_TASK_LIMIT);
  return loadTaskFlows(reader, projectId, rows);
}
