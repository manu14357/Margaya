import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { deriveCycleStatus } from "../cycle/dates";
import db from "../database";
import {
  activityTable,
  aiBriefTable,
  columnTable,
  cycleTable,
  cycleTaskTable,
  projectTable,
  taskRelationTable,
  taskTable,
} from "../database/schema";
import {
  cycleTimeStats,
  projectGroups,
  statusEventsByTask,
} from "../delivery/flow-history";
import { median } from "../delivery/stats";
import { getEnabledEstimate } from "../estimate/totals";
import { isNumericEstimateType } from "../estimate/types";
import { hiddenFromUserAndKey, insideRequestKey } from "../project/visibility";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { getProjectTimezone } from "../utils/timezone";
import {
  localDateString,
  startOfLocalDayUtc,
  startOfNextLocalDayUtc,
  todayInTimezone,
} from "../utils/zoned-date";
import { cycleScopeChanges, visibleScope } from "./retro-scope";
import { completedCycleDays, type InsightTaskRef, taskKey } from "./shared";

// Facts-first retrospectives (#15): a deterministic fact sheet of a cycle,
// computed from its membership history (cycle_changed activity), status
// history and relations. Team-level only: no fact is ever about a person
// (report 03, §5.1). The optional AI narrative (insight/ai.ts) only retells
// these facts.

/** Tasks listed per fact; the totals count all of them. */
export const RETRO_LIST_LIMIT = 25;
/** Cycle-time outliers listed. */
export const RETRO_OUTLIER_LIMIT = 5;
/** Below this many project samples, outliers use the cycle's own spread. */
const MIN_BASELINE_SAMPLES = 10;

type Member = InsightTaskRef & {
  group: string;
  completedAt: Date | null;
  addedAt: Date;
  numericValue: number | null;
};

type TaskList = { total: number; tasks: InsightTaskRef[] };

const listOf = (tasks: readonly InsightTaskRef[]): TaskList => ({
  total: tasks.length,
  tasks: tasks
    .slice(0, RETRO_LIST_LIMIT)
    .map(({ id, key, title, projectId }) => ({
      id,
      key,
      title,
      projectId,
    })),
});

const round1 = (value: number) => Math.round(value * 10) / 10;

async function currentMembers(cycleId: string, slug: string) {
  const rows = await db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      title: taskTable.title,
      projectId: taskTable.projectId,
      group: taskGroupSql,
      completedAt: taskTable.completedAt,
      addedAt: cycleTaskTable.addedAt,
      numericValue: sql<
        number | null
      >`(select ep.numeric_value from estimate_point ep where ep.id = ${taskTable.estimatePointId})`,
    })
    .from(cycleTaskTable)
    .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
    .innerJoin(
      cycleTable,
      and(
        eq(cycleTable.id, cycleTaskTable.cycleId),
        eq(cycleTable.projectId, taskTable.projectId),
      ),
    )
    .leftJoin(columnTable, taskColumnJoin)
    .where(and(eq(cycleTaskTable.cycleId, cycleId), visibleTaskCondition))
    .orderBy(asc(taskTable.number));
  return rows.map(
    (row): Member => ({
      id: row.id,
      key: taskKey(slug, row.number),
      title: row.title,
      projectId: row.projectId,
      group: row.group,
      completedAt: row.completedAt,
      addedAt: row.addedAt,
      numericValue: row.numericValue === null ? null : Number(row.numericValue),
    }),
  );
}

/** Membership changes in and out of the cycle, oldest first. */
async function membershipChanges(cycleId: string, projectId: string) {
  const rows = await db
    .select({
      taskId: activityTable.taskId,
      createdAt: activityTable.createdAt,
      eventData: activityTable.eventData,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .where(
      and(
        eq(taskTable.projectId, projectId),
        eq(activityTable.type, "cycle_changed"),
        sql`(${activityTable.eventData}->>'oldCycleId' = ${cycleId} or ${activityTable.eventData}->>'newCycleId' = ${cycleId})`,
      ),
    )
    .orderBy(asc(activityTable.createdAt), asc(activityTable.id));
  return rows.map((row) => {
    const data = (row.eventData ?? {}) as Record<string, unknown>;
    return {
      taskId: row.taskId,
      at: row.createdAt,
      joined: data.newCycleId === cycleId,
      left: data.oldCycleId === cycleId,
      toCycle: typeof data.newCycleId === "string" ? data.newCycleId : null,
    };
  });
}

async function taskRefs(
  ids: readonly string[],
  projectId: string,
  slug: string,
): Promise<Map<string, InsightTaskRef>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      title: taskTable.title,
      projectId: taskTable.projectId,
    })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.id, [...ids]),
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        key: taskKey(slug, row.number),
        title: row.title,
        projectId: row.projectId,
      },
    ]),
  );
}

/** Tasks that went from a completed column back to an open one. */
async function reopenedIds(
  projectId: string,
  ids: readonly string[],
  from: Date,
  to: Date,
) {
  if (ids.length === 0) return new Set<string>();
  const [groupOf, events] = await Promise.all([
    projectGroups(db, projectId),
    statusEventsByTask(db, ids),
  ]);
  const reopened = new Set<string>();
  for (const [taskId, list] of events) {
    for (const event of list) {
      if (event.at < from || event.at >= to) continue;
      const before = groupOf(event.oldStatus);
      const after = groupOf(event.newStatus);
      if (before === "completed" && after !== "completed") {
        reopened.add(taskId);
      }
    }
  }
  return reopened;
}

/**
 * Blocks relations into the cycle's tasks; hidden blockers are counted, but
 * a project-limited API key doesn't hear of blockers outside its projects.
 */
async function blockersOf(
  members: readonly Member[],
  userId: string,
  workspaceId: string,
) {
  if (members.length === 0) return [];
  const [rows, hidden] = await Promise.all([
    db
      .select({
        blockedId: taskRelationTable.targetTaskId,
        blockerId: taskTable.id,
        number: taskTable.number,
        title: taskTable.title,
        projectId: taskTable.projectId,
        slug: projectTable.slug,
        group: taskGroupSql,
      })
      .from(taskRelationTable)
      .innerJoin(taskTable, eq(taskTable.id, taskRelationTable.sourceTaskId))
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(
        and(
          inArray(
            taskRelationTable.targetTaskId,
            members.map((member) => member.id),
          ),
          eq(taskRelationTable.relationType, "blocks"),
          eq(projectTable.workspaceId, workspaceId),
          visibleTaskCondition,
          insideRequestKey(taskTable.projectId),
        ),
      ),
    hiddenFromUserAndKey(userId, workspaceId),
  ]);
  const hiddenSet = new Set(hidden);
  const byTask = new Map(members.map((member) => [member.id, member]));
  const result = new Map<
    string,
    {
      task: InsightTaskRef;
      blockers: Array<InsightTaskRef & { open: boolean }>;
      hiddenBlockers: number;
    }
  >();
  for (const row of rows) {
    const member = byTask.get(row.blockedId);
    if (!member) continue;
    const entry = result.get(member.id) ?? {
      task: {
        id: member.id,
        key: member.key,
        title: member.title,
        projectId: member.projectId,
      },
      blockers: [],
      hiddenBlockers: 0,
    };
    if (hiddenSet.has(row.projectId)) {
      entry.hiddenBlockers += 1;
    } else {
      entry.blockers.push({
        id: row.blockerId,
        key: taskKey(row.slug, row.number),
        title: row.title,
        projectId: row.projectId,
        open: row.group !== "completed" && row.group !== "cancelled",
      });
    }
    result.set(member.id, entry);
  }
  return [...result.values()];
}

/** The earliest saved forecast of this cycle (stakeholder briefs keep one). */
async function earliestForecast(cycleId: string, from: Date) {
  const rows = await db
    .select({ createdAt: aiBriefTable.createdAt, facts: aiBriefTable.facts })
    .from(aiBriefTable)
    .where(
      and(
        eq(aiBriefTable.scopeType, "cycle"),
        eq(aiBriefTable.scopeId, cycleId),
        isNotNull(aiBriefTable.sharedAt),
      ),
    )
    .orderBy(asc(aiBriefTable.createdAt))
    .limit(20);
  const row =
    rows.find((brief) => brief.createdAt >= from && brief.facts.forecastP85) ??
    rows.find((brief) => brief.facts.forecastP85);
  return row
    ? { p85: row.facts.forecastP85 as string, at: row.createdAt }
    : null;
}

export type RetroFacts = Awaited<ReturnType<typeof computeRetroFacts>>;

/** GET /insight/retro/cycle/{cycleId} */
export async function computeRetroFacts(input: {
  cycleId: string;
  userId: string;
  workspaceId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const [cycle] = await db
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      projectId: cycleTable.projectId,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
      slug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
    })
    .from(cycleTable)
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .where(eq(cycleTable.id, input.cycleId))
    .limit(1);
  if (!cycle || cycle.workspaceId !== input.workspaceId) {
    throw new HTTPException(404, { message: "Cycle not found" });
  }
  if (!cycle.startDate || !cycle.endDate) {
    throw new HTTPException(409, {
      message: "A retrospective needs a cycle with dates",
    });
  }
  const timeZone = await getProjectTimezone(cycle.projectId);
  const today = todayInTimezone(timeZone, now);
  const status = deriveCycleStatus(cycle, today);
  const start = startOfLocalDayUtc(cycle.startDate, timeZone);
  const end = startOfNextLocalDayUtc(cycle.endDate, timeZone);
  const ended = status === "completed";
  const windowEnd = ended ? end : now;

  const [members, changes, estimate] = await Promise.all([
    currentMembers(cycle.id, cycle.slug),
    membershipChanges(cycle.id, cycle.projectId),
    getEnabledEstimate(cycle.projectId, db),
  ]);
  const memberIds = new Set(members.map((member) => member.id));
  const scope = cycleScopeChanges({ members, changes, start, end });
  const leftOpen = ended
    ? members.filter(
        (member) =>
          member.group !== "completed" && member.group !== "cancelled",
      )
    : [];

  const refs = await taskRefs(
    [...scope.added, ...scope.removed, ...scope.carried].filter(
      (id) => !memberIds.has(id),
    ),
    cycle.projectId,
    cycle.slug,
  );
  // Counts and lists come from the same visible sets: a deleted or hidden
  // task is in neither.
  const { added, removed, carried } = visibleScope(
    scope,
    (id) => memberIds.has(id) || refs.has(id),
  );
  const everIds = [...new Set([...memberIds, ...removed, ...carried])];
  const committedIds = everIds.filter((id) => !added.has(id));
  const completed = members.filter(
    (member) =>
      member.group === "completed" &&
      member.completedAt !== null &&
      member.completedAt < windowEnd,
  );
  const completedIds = new Set(completed.map((member) => member.id));
  const committedDone = committedIds.filter((id) => completedIds.has(id));

  const [reopened, days, baseline, blocked, forecast] = await Promise.all([
    reopenedIds(cycle.projectId, everIds, start, windowEnd),
    completedCycleDays(
      db,
      cycle.projectId,
      completed.map((member) => member.id),
    ),
    cycleTimeStats(db, cycle.projectId, now),
    blockersOf(members, input.userId, input.workspaceId),
    earliestForecast(cycle.id, start),
  ]);

  // Cycle-time outliers: above the project's p85, or (with little project
  // history) above the cycle's own upper fence.
  const samples = completed.flatMap((member) => {
    const value = days.get(member.id);
    return value === undefined ? [] : [{ member, days: value }];
  });
  const cycleMedian = median(samples.map((sample) => sample.days));
  let threshold: number | null = null;
  let thresholdKind: "project_p85" | "cycle_spread" | null = null;
  if (baseline.samples >= MIN_BASELINE_SAMPLES && baseline.p85Days !== null) {
    threshold = baseline.p85Days;
    thresholdKind = "project_p85";
  } else if (samples.length >= 5 && cycleMedian !== null) {
    const sorted = samples.map((sample) => sample.days).sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length - 1) / 4)] ?? 0;
    const q3 = sorted[Math.ceil(((sorted.length - 1) * 3) / 4)] ?? 0;
    threshold = round1(q3 + 1.5 * (q3 - q1));
    thresholdKind = "cycle_spread";
  }
  const outliers =
    threshold === null
      ? []
      : samples
          .filter((sample) => sample.days > (threshold as number))
          .sort((a, b) => b.days - a.days)
          .slice(0, RETRO_OUTLIER_LIMIT)
          .map((sample) => ({
            id: sample.member.id,
            key: sample.member.key,
            title: sample.member.title,
            projectId: sample.member.projectId,
            days: round1(sample.days),
          }));

  const numeric = Boolean(estimate && isNumericEstimateType(estimate.type));
  const pointsOf = (list: readonly Member[]) =>
    round1(list.reduce((sum, member) => sum + (member.numericValue ?? 0), 0));
  const memberById = new Map(members.map((member) => [member.id, member]));
  const refOf = (id: string) => memberById.get(id) ?? refs.get(id);
  const refsOf = (ids: Iterable<string>) =>
    [...ids].flatMap((id) => {
      const ref = refOf(id);
      return ref ? [ref] : [];
    });

  const lastCommittedDone = committedDone
    .map((id) => memberById.get(id)?.completedAt?.getTime() ?? 0)
    .reduce((max, value) => Math.max(max, value), 0);
  const allCommittedDone =
    committedIds.length > 0 && committedDone.length === committedIds.length;
  const finishedOn = allCommittedDone
    ? localDateString(new Date(lastCommittedDone), timeZone)
    : null;

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      projectId: cycle.projectId,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      status,
    },
    generatedAt: now.toISOString(),
    counts: {
      committed: committedIds.length,
      completed: completed.length,
      committedCompleted: committedDone.length,
      added: added.size,
      removed: removed.size,
      carriedOver: carried.size,
      leftOpen: leftOpen.length,
      reopened: reopened.size,
      blocked: blocked.length,
    },
    sayDoPercent:
      committedIds.length === 0
        ? null
        : Math.round((committedDone.length / committedIds.length) * 100),
    points: numeric
      ? {
          committed: pointsOf(
            members.filter(
              (member) => !added.has(member.id) && member.group !== "cancelled",
            ),
          ),
          completed: pointsOf(completed),
        }
      : null,
    added: listOf(refsOf(added)),
    removed: listOf(refsOf(removed)),
    carriedOver: listOf(refsOf(carried)),
    leftOpen: listOf(leftOpen),
    reopened: listOf(refsOf(reopened)),
    cycleTime: {
      samples: samples.length,
      medianDays: cycleMedian === null ? null : round1(cycleMedian),
      projectP85Days: baseline.p85Days,
      threshold,
      thresholdKind,
      outliers,
    },
    blocked: blocked.slice(0, RETRO_LIST_LIMIT),
    forecast: {
      p85: forecast?.p85 ?? null,
      madeAt: forecast ? forecast.at.toISOString() : null,
      finishedOn,
      endDate: cycle.endDate,
      met:
        forecast && ended
          ? finishedOn !== null && finishedOn <= forecast.p85
          : null,
    },
  };
}

/** Every task the facts name: what a narrative may cite. */
export function retroCitable(facts: RetroFacts): InsightTaskRef[] {
  const seen = new Map<string, InsightTaskRef>();
  const add = (task: InsightTaskRef) => {
    if (!seen.has(task.key)) {
      seen.set(task.key, {
        id: task.id,
        key: task.key,
        title: task.title,
        projectId: task.projectId,
      });
    }
  };
  for (const list of [
    facts.added,
    facts.removed,
    facts.carriedOver,
    facts.leftOpen,
    facts.reopened,
  ]) {
    for (const task of list.tasks) add(task);
  }
  for (const task of facts.cycleTime.outliers) add(task);
  for (const entry of facts.blocked) {
    add(entry.task);
    for (const blocker of entry.blockers) add(blocker);
  }
  return [...seen.values()];
}
