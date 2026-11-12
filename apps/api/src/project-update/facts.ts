import {
  and,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  columnTable,
  cycleTable,
  cycleTaskTable,
  projectTable,
  projectUpdateTable,
  taskTable,
} from "../database/schema";
import { getForecast } from "../delivery/forecast";
import { getScopeRisks } from "../delivery/risk";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { getWorkspaceTimezone } from "../utils/timezone";
import { todayInTimezone } from "../utils/zoned-date";
import type {
  ProjectUpdateCycleFact,
  ProjectUpdateFacts,
  ProjectUpdateHealth,
  ProjectUpdateRiskFact,
  ProjectUpdateTaskList,
  ProjectUpdateTaskRef,
} from "./types";

// The facts a project update is drafted from, all computed here from live
// data since the project's last update: completed and moved tasks, overdue
// and blocked work, active cycles, delivery risks and the forecast. Drafts
// (template or AI) only put words around these numbers. Computed on demand
// (the Draft button), never on routine task writes.

/** Project tasks read per draft; more are counted as truncated. */
export const FACTS_TASK_LIMIT = 2000;
/** Tasks listed per fact. */
export const FACTS_LIST_LIMIT = 10;
/** Without an earlier update, "recent" means the last 7 days. */
export const DEFAULT_WINDOW_DAYS = 7;
/** Active cycles listed. */
const CYCLE_LIMIT = 3;

const DAY_MS = 86_400_000;

type TaskRow = {
  id: string;
  number: number | null;
  title: string;
  group: string;
  completedAt: Date | null;
  createdAt: Date;
  dueDate: Date | null;
};

export function taskKey(slug: string, number: number | null): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

function list(
  rows: readonly ProjectUpdateTaskRef[],
  limit = FACTS_LIST_LIMIT,
): ProjectUpdateTaskList {
  return { total: rows.length, tasks: rows.slice(0, limit) };
}

const OPEN_GROUPS = new Set(["backlog", "unstarted", "started"]);

async function safely<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    // Risks and forecast are optional facts: a draft still works without.
    console.error("Project update fact unavailable", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

/** When the project's latest update was posted, if ever. */
export async function lastUpdateAt(projectId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: projectUpdateTable.createdAt })
    .from(projectUpdateTable)
    .where(eq(projectUpdateTable.projectId, projectId))
    .orderBy(desc(projectUpdateTable.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

async function activeCycles(
  projectId: string,
  today: string,
): Promise<ProjectUpdateCycleFact[]> {
  const cycles = await db
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      endDate: cycleTable.endDate,
    })
    .from(cycleTable)
    .where(
      and(
        eq(cycleTable.projectId, projectId),
        isNull(cycleTable.archivedAt),
        lte(cycleTable.startDate, today),
        gte(cycleTable.endDate, today),
      ),
    )
    .orderBy(cycleTable.endDate)
    .limit(CYCLE_LIMIT);
  if (cycles.length === 0) return [];
  const rows = await db
    .select({
      cycleId: cycleTaskTable.cycleId,
      total:
        sql<number>`count(*) filter (where ${taskGroupSql} <> 'cancelled')`.mapWith(
          Number,
        ),
      completed:
        sql<number>`count(*) filter (where ${taskGroupSql} = 'completed')`.mapWith(
          Number,
        ),
    })
    .from(cycleTaskTable)
    .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        inArray(
          cycleTaskTable.cycleId,
          cycles.map((cycle) => cycle.id),
        ),
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
      ),
    )
    .groupBy(cycleTaskTable.cycleId);
  const byCycle = new Map(rows.map((row) => [row.cycleId, row]));
  return cycles.map((cycle) => {
    const row = byCycle.get(cycle.id);
    const total = row?.total ?? 0;
    const completed = row?.completed ?? 0;
    return {
      id: cycle.id,
      name: cycle.name,
      endDate: cycle.endDate ?? today,
      total,
      completed,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  });
}

async function movedSince(projectId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: countDistinct(activityTable.taskId) })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .where(
      and(
        eq(taskTable.projectId, projectId),
        eq(activityTable.type, "status_changed"),
        gte(activityTable.createdAt, since),
        visibleTaskCondition,
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * A rule-based health, so a draft without AI still suggests one: off track
 * on a high-severity risk or when at least a quarter of open work (and 3+
 * tasks) is overdue; at risk on any other risk, overdue or blocked task.
 */
export function suggestHealth(input: {
  open: number;
  overdue: number;
  blocked: number;
  risks: readonly ProjectUpdateRiskFact[];
}): ProjectUpdateHealth {
  const high = input.risks.some((risk) => risk.severity === "high");
  if (
    high ||
    (input.overdue >= 3 && input.overdue * 4 >= Math.max(input.open, 1))
  ) {
    return "off_track";
  }
  const medium = input.risks.some((risk) => risk.severity === "medium");
  if (medium || input.overdue > 0 || input.blocked > 0) return "at_risk";
  return "on_track";
}

export async function computeProjectUpdateFacts(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  now?: Date;
}): Promise<ProjectUpdateFacts> {
  const now = input.now ?? new Date();
  const { projectId, userId } = input;
  const [project] = await db
    .select({
      slug: projectTable.slug,
      cyclesEnabled: projectTable.cyclesEnabled,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  const slug = project?.slug ?? "";

  const [previous, timeZone] = await Promise.all([
    lastUpdateAt(projectId),
    getWorkspaceTimezone(input.workspaceId),
  ]);
  const since =
    previous ?? new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  const today = todayInTimezone(timeZone, now);

  const [rows, moved, cycles, risks, forecast] = await Promise.all([
    db
      .select({
        id: taskTable.id,
        number: taskTable.number,
        title: taskTable.title,
        group: taskGroupSql,
        completedAt: taskTable.completedAt,
        createdAt: taskTable.createdAt,
        dueDate: taskTable.dueDate,
      })
      .from(taskTable)
      .leftJoin(columnTable, taskColumnJoin)
      .where(and(eq(taskTable.projectId, projectId), visibleTaskCondition))
      .orderBy(desc(taskTable.number))
      .limit(FACTS_TASK_LIMIT + 1) as Promise<TaskRow[]>,
    movedSince(projectId, since),
    project?.cyclesEnabled ? activeCycles(projectId, today) : [],
    safely(() => getScopeRisks("project", projectId, userId)),
    safely(() => getForecast("project", projectId)),
  ]);
  const truncated = rows.length > FACTS_TASK_LIMIT;
  const tasks = rows.slice(0, FACTS_TASK_LIMIT);
  const ref = (task: { id: string; number: number | null; title: string }) => ({
    id: task.id,
    key: taskKey(slug, task.number),
    title: task.title,
  });

  let completedTotal = 0;
  let cancelled = 0;
  const open: TaskRow[] = [];
  for (const task of tasks) {
    if (task.group === "completed") completedTotal += 1;
    else if (task.group === "cancelled") cancelled += 1;
    else if (OPEN_GROUPS.has(task.group)) open.push(task);
  }
  const counted = tasks.length - cancelled;
  const completedSince = tasks
    .filter(
      (task) =>
        task.group === "completed" &&
        task.completedAt !== null &&
        task.completedAt >= since,
    )
    .sort(
      (a, b) =>
        (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
    );
  const overdue = open
    .filter((task) => task.dueDate !== null && task.dueDate < now)
    .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
  const inProgress = open.filter((task) => task.group === "started");
  const added = tasks.filter((task) => task.createdAt >= since).length;

  // Blocked tasks come from the delivery risk graph (open "blocks" edges),
  // which already leaves out what the caller can't see.
  const riskTasks = new Map(
    (risks?.tasks ?? []).map((task) => [
      task.id,
      {
        id: task.id,
        key: taskKey(task.projectSlug, task.number),
        title: task.title,
      },
    ]),
  );
  const blockedIds = new Set<string>();
  for (const signal of risks?.signals ?? []) {
    if (signal.kind !== "blocked_chain") continue;
    for (const id of signal.taskIds) blockedIds.add(id);
  }
  const blocked = [...blockedIds]
    .map((id) => riskTasks.get(id))
    .filter((task): task is ProjectUpdateTaskRef => Boolean(task));
  const riskFacts: ProjectUpdateRiskFact[] = (risks?.signals ?? []).map(
    (signal) => ({
      kind: signal.kind,
      severity: signal.severity,
      total: signal.total,
    }),
  );

  return {
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    sinceLastUpdate: previous !== null,
    counts: {
      total: tasks.length,
      open: open.length,
      completed: completedTotal,
      percent: counted <= 0 ? 0 : Math.round((completedTotal / counted) * 100),
    },
    completed: list(completedSince.map(ref)),
    moved: { total: moved },
    added: { total: added },
    overdue: list(overdue.map(ref)),
    blocked: list(blocked),
    inProgress: list(inProgress.map(ref)),
    cycles,
    risks: riskFacts,
    forecastP85:
      forecast?.status === "ok" ? (forecast.p85?.date ?? null) : null,
    suggestedHealth: suggestHealth({
      open: open.length,
      overdue: overdue.length,
      blocked: blocked.length,
      risks: riskFacts,
    }),
    truncated,
  };
}
