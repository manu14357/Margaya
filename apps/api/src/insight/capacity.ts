import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  columnTable,
  cycleTable,
  cycleTaskTable,
  projectTable,
  taskRelationTable,
  taskTable,
  userTable,
} from "../database/schema";
import { dailyThroughput } from "../delivery/flow-history";
import { median } from "../delivery/stats";
import { getEnabledEstimate } from "../estimate/totals";
import { isNumericEstimateType } from "../estimate/types";
import { insideRequestKey } from "../project/visibility";
import { assigneesOfTasks } from "../task/assignees";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { daySpan, shiftDate } from "../utils/calendar-date";
import { getProjectTimezone } from "../utils/timezone";
import { startOfNextLocalDayUtc, todayInTimezone } from "../utils/zoned-date";
import {
  type CapacityRange,
  capacityFromCycles,
  capacityFromThroughput,
  HISTORY_CYCLES,
  loadAgainst,
  type PastCycle,
  suggestDeferrals,
  THROUGHPUT_WINDOW_DAYS,
} from "./capacity-math";
import { taskKey } from "./shared";

// Capacity check for cycles (#10): the cycle's committed work against what
// the team finished in comparable time before. Team-level by default; the
// per-assignee load is only returned to people who manage cycles, and it is
// load against their own usual, never a score (report 03, §5.1).

const membershipJoin = and(
  eq(cycleTable.id, cycleTaskTable.cycleId),
  eq(cycleTable.projectId, taskTable.projectId),
) as SQL;

type Unit = "tasks" | "points";

type ScopeRow = {
  id: string;
  number: number | null;
  title: string;
  priority: string;
  group: string;
  numericValue: number | null;
};

async function cycleScope(cycleId: string): Promise<ScopeRow[]> {
  const rows = await db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      title: taskTable.title,
      priority: taskTable.priority,
      group: taskGroupSql,
      numericValue: sql<
        number | null
      >`(select ep.numeric_value from estimate_point ep where ep.id = ${taskTable.estimatePointId})`,
    })
    .from(cycleTaskTable)
    .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
    .innerJoin(cycleTable, membershipJoin)
    .leftJoin(columnTable, taskColumnJoin)
    .where(and(eq(cycleTaskTable.cycleId, cycleId), visibleTaskCondition));
  return rows.map((row) => ({
    ...row,
    numericValue: row.numericValue === null ? null : Number(row.numericValue),
  }));
}

/**
 * Open tasks each scope task blocks (task relations "blocks"). Like risks,
 * tasks the caller can't see count unnamed, but a project-limited API key
 * doesn't hear of tasks outside its projects.
 */
async function dependantCounts(taskIds: readonly string[]) {
  const counts = new Map<string, number>();
  if (taskIds.length === 0) return counts;
  const rows = await db
    .select({
      id: taskRelationTable.sourceTaskId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(taskRelationTable)
    .innerJoin(taskTable, eq(taskTable.id, taskRelationTable.targetTaskId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        inArray(taskRelationTable.sourceTaskId, [...taskIds]),
        eq(taskRelationTable.relationType, "blocks"),
        visibleTaskCondition,
        sql`${taskGroupSql} in ('backlog', 'unstarted', 'started')`,
        insideRequestKey(taskTable.projectId),
      ),
    )
    .groupBy(taskRelationTable.sourceTaskId);
  for (const row of rows) counts.set(row.id, row.count);
  return counts;
}

type PastCycleRow = {
  id: string;
  startDate: string;
  endDate: string;
};

/** The project's last ended cycles before `before`, newest first. */
async function pastCycles(
  projectId: string,
  excludeId: string,
  before: string,
): Promise<PastCycleRow[]> {
  const rows = await db
    .select({
      id: cycleTable.id,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
    })
    .from(cycleTable)
    .where(
      and(
        eq(cycleTable.projectId, projectId),
        ne(cycleTable.id, excludeId),
        isNotNull(cycleTable.startDate),
        isNotNull(cycleTable.endDate),
        lt(cycleTable.endDate, before),
      ),
    )
    .orderBy(desc(cycleTable.endDate))
    .limit(HISTORY_CYCLES);
  return rows.flatMap((row) =>
    row.startDate && row.endDate
      ? [{ id: row.id, startDate: row.startDate, endDate: row.endDate }]
      : [],
  );
}

/** Tasks each past cycle completed by its end (in the workspace zone). */
async function pastCompletions(cycles: PastCycleRow[], timeZone: string) {
  if (cycles.length === 0) return [];
  const rows = await db
    .select({
      taskId: taskTable.id,
      cycleId: cycleTaskTable.cycleId,
      completedAt: taskTable.completedAt,
      numericValue: sql<
        number | null
      >`(select ep.numeric_value from estimate_point ep where ep.id = ${taskTable.estimatePointId})`,
    })
    .from(cycleTaskTable)
    .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
    .innerJoin(cycleTable, membershipJoin)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        inArray(
          cycleTaskTable.cycleId,
          cycles.map((cycle) => cycle.id),
        ),
        visibleTaskCondition,
        sql`${taskGroupSql} = 'completed'`,
        isNotNull(taskTable.completedAt),
      ),
    );
  const ends = new Map(
    cycles.map((cycle) => [
      cycle.id,
      startOfNextLocalDayUtc(cycle.endDate, timeZone),
    ]),
  );
  return rows.filter((row) => {
    const end = ends.get(row.cycleId);
    return end && row.completedAt && row.completedAt < end;
  });
}

const inclusiveDays = (start: string, end: string) => daySpan(start, end) + 1;

export type CapacityCheck = Awaited<ReturnType<typeof getCycleCapacity>>;

/** GET /insight/capacity/cycle/{cycleId} */
export async function getCycleCapacity(
  cycleId: string,
  options: { includeMembers: boolean; now?: Date },
) {
  const now = options.now ?? new Date();
  const [cycle] = await db
    .select({
      id: cycleTable.id,
      projectId: cycleTable.projectId,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
      slug: projectTable.slug,
    })
    .from(cycleTable)
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .where(eq(cycleTable.id, cycleId))
    .limit(1);
  if (!cycle) throw new HTTPException(404, { message: "Cycle not found" });

  const timeZone = await getProjectTimezone(cycle.projectId);
  const today = todayInTimezone(timeZone, now);
  const [scope, estimate] = await Promise.all([
    cycleScope(cycleId),
    getEnabledEstimate(cycle.projectId, db),
  ]);
  const committed = scope.filter((task) => task.group !== "cancelled");
  const numeric = Boolean(estimate && isNumericEstimateType(estimate.type));
  const estimated = committed.filter((task) => task.numericValue !== null);
  const committedPoints = numeric
    ? estimated.reduce((sum, task) => sum + (task.numericValue ?? 0), 0)
    : null;

  const base = {
    cycleId,
    plannedDays: null as number | null,
    basis: "none" as "cycles" | "throughput" | "none",
    historyCycles: 0,
    unit: "tasks" as Unit,
    estimateType: estimate?.type ?? null,
    committed: {
      tasks: committed.length,
      estimatedTasks: estimated.length,
      points:
        committedPoints === null ? null : Math.round(committedPoints * 10) / 10,
    },
    capacity: null as CapacityRange | null,
    load: null as number | null,
    percent: null as number | null,
    status: "unknown" as "ok" | "over" | "unknown",
    deferrals: [] as Array<{
      id: string;
      key: string;
      title: string;
      priority: string;
      size: number;
      dependants: number;
    }>,
    members: null as null | Array<{
      userId: string | null;
      name: string | null;
      tasks: number;
      points: number | null;
      typical: number | null;
      status: "ok" | "over" | "unknown";
    }>,
  };
  if (!cycle.startDate || !cycle.endDate) return base;
  const plannedDays = inclusiveDays(cycle.startDate, cycle.endDate);

  // History: ended cycles before this one starts (or before today).
  const before = cycle.startDate < today ? cycle.startDate : today;
  const past = await pastCycles(cycle.projectId, cycle.id, before);
  const completions = await pastCompletions(past, timeZone);
  const pastStats: PastCycle[] = past.map((row) => {
    const done = completions.filter((entry) => entry.cycleId === row.id);
    const points = done.reduce(
      (sum, entry) =>
        sum + (entry.numericValue === null ? 0 : Number(entry.numericValue)),
      0,
    );
    return {
      days: inclusiveDays(row.startDate, row.endDate),
      completedTasks: done.length,
      completedPoints: numeric && points > 0 ? points : null,
    };
  });

  let basis: "cycles" | "throughput" | "none" = "none";
  let tasksCapacity: CapacityRange | null = null;
  let pointsCapacity: CapacityRange | null = null;
  const fromCycles = capacityFromCycles(pastStats, plannedDays);
  if (fromCycles) {
    basis = "cycles";
    tasksCapacity = fromCycles.tasks;
    pointsCapacity = numeric ? fromCycles.points : null;
  } else {
    const daily = await dailyThroughput(
      db,
      cycle.projectId,
      shiftDate(today, -THROUGHPUT_WINDOW_DAYS),
      shiftDate(today, -1),
      timeZone,
    );
    tasksCapacity = capacityFromThroughput(daily, plannedDays);
    if (tasksCapacity) basis = "throughput";
  }

  // Points when the system is numeric, has history, and most work is sized.
  const unit: Unit =
    pointsCapacity &&
    committedPoints !== null &&
    estimated.length * 2 >= committed.length
      ? "points"
      : "tasks";
  const capacity = unit === "points" ? pointsCapacity : tasksCapacity;
  const load = unit === "points" ? (committedPoints ?? 0) : committed.length;
  const { percent, status } = loadAgainst(load, capacity);

  let deferrals: typeof base.deferrals = [];
  if (status === "over" && capacity) {
    const notStarted = committed.filter(
      (task) => task.group === "backlog" || task.group === "unstarted",
    );
    const dependants = await dependantCounts(notStarted.map((task) => task.id));
    const sizeOf = (task: ScopeRow) =>
      unit === "points" ? (task.numericValue ?? 0) : 1;
    const picked = suggestDeferrals(
      notStarted.map((task) => ({
        id: task.id,
        priority: task.priority,
        dependants: dependants.get(task.id) ?? 0,
        size: sizeOf(task),
      })),
      load - capacity.typical,
    );
    const byId = new Map(notStarted.map((task) => [task.id, task]));
    deferrals = picked.flatMap((id) => {
      const task = byId.get(id);
      return task
        ? [
            {
              id,
              key: taskKey(cycle.slug, task.number),
              title: task.title,
              priority: task.priority,
              size: sizeOf(task),
              dependants: dependants.get(id) ?? 0,
            },
          ]
        : [];
    });
  }

  const members = options.includeMembers
    ? await memberLoads({
        committed,
        completions,
        past,
        plannedDays,
        unit,
        basis,
      })
    : null;

  return {
    ...base,
    plannedDays,
    basis,
    historyCycles: pastStats.length,
    unit,
    capacity,
    load: Math.round(load * 10) / 10,
    percent,
    status,
    deferrals,
    members,
  };
}

/**
 * Each assignee's share of the committed work, against what they usually
 * finished per cycle (median over the past cycles, scaled to this length).
 * Only with a cycle history; a task with several assignees counts for each.
 */
async function memberLoads(input: {
  committed: ScopeRow[];
  completions: Awaited<ReturnType<typeof pastCompletions>>;
  past: PastCycleRow[];
  plannedDays: number;
  unit: Unit;
  basis: "cycles" | "throughput" | "none";
}) {
  const { committed, completions, past, plannedDays, unit } = input;
  const [current, history] = await Promise.all([
    assigneesOfTasks(committed.map((task) => task.id)),
    assigneesOfTasks(completions.map((entry) => entry.taskId)),
  ]);
  const sizeOf = (value: number | null) =>
    unit === "points" ? (value ?? 0) : 1;
  const loads = new Map<string | null, { tasks: number; points: number }>();
  for (const task of committed) {
    const ids = current.get(task.id) ?? [];
    for (const userId of ids.length > 0 ? ids : [null]) {
      const entry = loads.get(userId) ?? { tasks: 0, points: 0 };
      entry.tasks += 1;
      entry.points += task.numericValue ?? 0;
      loads.set(userId, entry);
    }
  }
  // Per user, per past cycle: completed work per day.
  const rates = new Map<string, number[]>();
  if (input.basis === "cycles") {
    for (const row of past) {
      const days = daySpan(row.startDate, row.endDate) + 1;
      const perUser = new Map<string, number>();
      for (const entry of completions) {
        if (entry.cycleId !== row.id) continue;
        for (const userId of history.get(entry.taskId) ?? []) {
          perUser.set(
            userId,
            (perUser.get(userId) ?? 0) +
              sizeOf(
                entry.numericValue === null ? null : Number(entry.numericValue),
              ),
          );
        }
      }
      for (const userId of loads.keys()) {
        if (!userId) continue;
        const list = rates.get(userId) ?? [];
        list.push((perUser.get(userId) ?? 0) / days);
        rates.set(userId, list);
      }
    }
  }
  const userIds = [...loads.keys()].filter((id): id is string => Boolean(id));
  const names = userIds.length
    ? await db
        .select({ id: userTable.id, name: userTable.name })
        .from(userTable)
        .where(inArray(userTable.id, userIds))
    : [];
  const nameOf = new Map(names.map((row) => [row.id, row.name]));
  return [...loads.entries()]
    .map(([userId, entry]) => {
      const list = userId ? (rates.get(userId) ?? []) : [];
      // Someone new to the team has no usual yet: unknown, never "over".
      const usual = list.some((rate) => rate > 0) ? median(list) : null;
      const typical =
        usual === null ? null : Math.round(usual * plannedDays * 10) / 10;
      const load = unit === "points" ? entry.points : entry.tasks;
      return {
        userId,
        name: userId ? (nameOf.get(userId) ?? null) : null,
        tasks: entry.tasks,
        points: unit === "points" ? Math.round(entry.points * 10) / 10 : null,
        typical,
        status:
          typical === null
            ? ("unknown" as const)
            : load > typical
              ? ("over" as const)
              : ("ok" as const),
      };
    })
    .sort(
      (a, b) =>
        Number(a.userId === null) - Number(b.userId === null) ||
        b.tasks - a.tasks ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );
}
