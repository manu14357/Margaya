import { and, desc, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  aiBriefTable,
  columnTable,
  cycleTable,
  cycleTaskTable,
  moduleTable,
  moduleTaskTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { getForecast } from "../delivery/forecast";
import { getScopeRisks } from "../delivery/risk";
import { linkModuleJoin, linkTaskJoin } from "../module/queries";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import type { BriefScopeType, BriefSnapshot, BriefTaskState } from "./types";

// The facts a stakeholder brief is written from, all computed here: counts,
// progress, what changed, risks and the forecast (delivery/). The model
// only narrates them; it never computes a number (report 03, §5.4).

/** Scope tasks read per brief; more are counted but not listed. */
export const BRIEF_TASK_LIMIT = 2000;
/** Tasks listed per fact (completed, added, removed, in progress). */
export const BRIEF_LIST_LIMIT = 25;
/** Without an earlier shared brief, "recent" means the last 7 days. */
export const DEFAULT_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

export type BriefTaskRef = {
  id: string;
  key: string;
  title: string;
  projectId: string;
};

type ScopeTaskRow = BriefTaskRef & {
  state: BriefTaskState;
  completedAt: Date | null;
  addedAt: Date;
};

export type BriefScope = {
  type: BriefScopeType;
  id: string;
  projectId: string;
  workspaceId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  restricted: boolean;
};

const STATE_OF_GROUP: Record<string, BriefTaskState> = {
  backlog: "b",
  unstarted: "u",
  started: "s",
  completed: "d",
  cancelled: "c",
};

function keyOf(slug: string, number: number | null): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

/** The cycle, module or project; 404 when it is not in the workspace. */
export async function resolveBriefScope(
  workspaceId: string,
  type: BriefScopeType,
  id: string,
): Promise<BriefScope> {
  let projectId = id;
  let name = "";
  let startDate: string | null = null;
  let endDate: string | null = null;
  if (type === "cycle") {
    const [cycle] = await db
      .select({
        projectId: cycleTable.projectId,
        name: cycleTable.name,
        startDate: cycleTable.startDate,
        endDate: cycleTable.endDate,
      })
      .from(cycleTable)
      .where(eq(cycleTable.id, id))
      .limit(1);
    if (!cycle) throw new HTTPException(404, { message: "Cycle not found" });
    ({ projectId, name, startDate, endDate } = cycle);
  } else if (type === "module") {
    const [module] = await db
      .select({
        projectId: moduleTable.projectId,
        name: moduleTable.name,
        startDate: moduleTable.startDate,
        endDate: moduleTable.targetDate,
      })
      .from(moduleTable)
      .where(eq(moduleTable.id, id))
      .limit(1);
    if (!module) throw new HTTPException(404, { message: "Module not found" });
    ({ projectId, name, startDate, endDate } = module);
  }
  const [project] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      name: projectTable.name,
      visibility: projectTable.visibility,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project || project.deletedAt || project.workspaceId !== workspaceId) {
    throw new HTTPException(404, {
      message: `${type === "cycle" ? "Cycle" : type === "module" ? "Module" : "Project"} not found`,
    });
  }
  return {
    type,
    id,
    projectId,
    workspaceId,
    name: type === "project" ? project.name : name,
    startDate,
    endDate,
    restricted: project.visibility === "restricted",
  };
}

async function scopeTaskRows(scope: BriefScope) {
  const base = {
    id: taskTable.id,
    number: taskTable.number,
    title: taskTable.title,
    projectId: taskTable.projectId,
    slug: projectTable.slug,
    group: taskGroupSql,
    completedAt: taskTable.completedAt,
  };
  if (scope.type === "cycle") {
    return db
      .select({ ...base, addedAt: cycleTaskTable.addedAt })
      .from(cycleTaskTable)
      .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
      .innerJoin(
        cycleTable,
        and(
          eq(cycleTable.id, cycleTaskTable.cycleId),
          eq(cycleTable.projectId, taskTable.projectId),
        ) as SQL,
      )
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(and(eq(cycleTaskTable.cycleId, scope.id), visibleTaskCondition))
      .orderBy(desc(taskTable.number))
      .limit(BRIEF_TASK_LIMIT + 1);
  }
  if (scope.type === "module") {
    return db
      .select({ ...base, addedAt: moduleTaskTable.createdAt })
      .from(moduleTaskTable)
      .innerJoin(taskTable, linkTaskJoin)
      .innerJoin(moduleTable, linkModuleJoin)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(and(eq(moduleTaskTable.moduleId, scope.id), visibleTaskCondition))
      .orderBy(desc(taskTable.number))
      .limit(BRIEF_TASK_LIMIT + 1);
  }
  return db
    .select({ ...base, addedAt: taskTable.createdAt })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(and(eq(taskTable.projectId, scope.projectId), visibleTaskCondition))
    .orderBy(desc(taskTable.number))
    .limit(BRIEF_TASK_LIMIT + 1);
}

async function loadScopeTasks(scope: BriefScope) {
  const rows = await scopeTaskRows(scope);
  const truncated = rows.length > BRIEF_TASK_LIMIT;
  const tasks: ScopeTaskRow[] = rows.slice(0, BRIEF_TASK_LIMIT).map((row) => ({
    id: row.id,
    key: keyOf(row.slug, row.number),
    title: row.title,
    projectId: row.projectId,
    state: STATE_OF_GROUP[row.group] ?? "u",
    completedAt: row.completedAt,
    addedAt: row.addedAt,
  }));
  return { tasks, truncated };
}

/** The latest brief of this scope that was saved or copied, if any. */
export async function lastSharedBrief(type: BriefScopeType, id: string) {
  const [row] = await db
    .select({
      id: aiBriefTable.id,
      facts: aiBriefTable.facts,
      createdAt: aiBriefTable.createdAt,
      sharedAt: aiBriefTable.sharedAt,
    })
    .from(aiBriefTable)
    .where(
      and(
        eq(aiBriefTable.scopeType, type),
        eq(aiBriefTable.scopeId, id),
        isNotNull(aiBriefTable.sharedAt),
      ),
    )
    .orderBy(desc(aiBriefTable.sharedAt))
    .limit(1);
  return row ?? null;
}

export function percentDone(counts: Record<BriefTaskState, number>): number {
  const total = counts.b + counts.u + counts.s + counts.d;
  return total === 0 ? 0 : Math.round((counts.d / total) * 100);
}

const ref = (task: BriefTaskRef): BriefTaskRef => ({
  id: task.id,
  key: task.key,
  title: task.title,
  projectId: task.projectId,
});

async function safely<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    // Risks and forecast are optional facts: a brief still works without.
    console.error("Brief fact unavailable", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

export async function computeBriefFacts(
  scope: BriefScope,
  userId: string,
  now: Date = new Date(),
) {
  const [{ tasks, truncated }, previous, forecast, risks] = await Promise.all([
    loadScopeTasks(scope),
    lastSharedBrief(scope.type, scope.id),
    safely(() => getForecast(scope.type, scope.id)),
    safely(() => getScopeRisks(scope.type, scope.id, userId)),
  ]);
  const since = previous
    ? previous.createdAt
    : new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);

  const counts: Record<BriefTaskState, number> = {
    b: 0,
    u: 0,
    s: 0,
    d: 0,
    c: 0,
  };
  for (const task of tasks) counts[task.state] += 1;
  const percent = percentDone(counts);

  const before = previous?.facts.tasks ?? null;
  const completed = tasks.filter((task) =>
    before
      ? task.state === "d" && before[task.id] !== "d"
      : task.state === "d" &&
        task.completedAt !== null &&
        task.completedAt >= since,
  );
  const added = tasks.filter((task) =>
    before ? !(task.id in before) : task.addedAt >= since,
  );
  const current = new Set(tasks.map((task) => task.id));
  const removedIds = before
    ? Object.keys(before).filter((id) => !current.has(id))
    : [];
  const removedRows =
    removedIds.length > 0
      ? await db
          .select({
            id: taskTable.id,
            number: taskTable.number,
            title: taskTable.title,
            projectId: taskTable.projectId,
            slug: projectTable.slug,
          })
          .from(taskTable)
          .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
          // Only tasks of the scope's project: others may be hidden.
          .where(
            and(
              inArray(taskTable.id, removedIds.slice(0, BRIEF_LIST_LIMIT)),
              eq(taskTable.projectId, scope.projectId),
            ),
          )
      : [];
  const inProgress = tasks.filter((task) => task.state === "s");

  const riskTasks = new Map(
    (risks?.tasks ?? []).map((task) => [
      task.id,
      {
        id: task.id,
        key: keyOf(task.projectSlug, task.number),
        title: task.title,
        projectId: task.projectId,
      },
    ]),
  );
  const riskSignals = (risks?.signals ?? []).map((signal) => ({
    kind: signal.kind,
    severity: signal.severity,
    total: signal.total,
    tasks: signal.taskIds
      .map((id) => riskTasks.get(id))
      .filter((task): task is BriefTaskRef => Boolean(task))
      .slice(0, 5),
  }));
  const riskCounts: Record<string, number> = {};
  for (const signal of riskSignals) {
    riskCounts[signal.kind] = (riskCounts[signal.kind] ?? 0) + signal.total;
  }
  const forecastP85 =
    forecast?.status === "ok" ? (forecast.p85?.date ?? null) : null;

  const snapshot: BriefSnapshot = {
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task.state])),
    percent,
    forecastP85,
    risks: riskCounts,
  };

  const facts = {
    scope: {
      type: scope.type,
      id: scope.id,
      projectId: scope.projectId,
      name: scope.name,
      startDate: scope.startDate,
      endDate: scope.endDate,
    },
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    truncated,
    counts: {
      total: tasks.length,
      backlog: counts.b,
      unstarted: counts.u,
      started: counts.s,
      completed: counts.d,
      cancelled: counts.c,
    },
    percent,
    completed: {
      total: completed.length,
      tasks: completed.slice(0, BRIEF_LIST_LIMIT).map(ref),
    },
    added: {
      total: added.length,
      tasks: added.slice(0, BRIEF_LIST_LIMIT).map(ref),
    },
    removed: {
      total: removedIds.length,
      tasks: removedRows.map((row) => ({
        id: row.id,
        key: keyOf(row.slug, row.number),
        title: row.title,
        projectId: row.projectId,
      })),
    },
    inProgress: {
      total: inProgress.length,
      tasks: inProgress.slice(0, BRIEF_LIST_LIMIT).map(ref),
    },
    risks: riskSignals,
    forecast:
      forecast === null
        ? null
        : {
            status: forecast.status,
            remaining: forecast.remaining,
            p50: forecast.p50?.date ?? null,
            p85: forecast.p85?.date ?? null,
            p95: forecast.p95?.date ?? null,
            probabilityByEnd:
              forecast.probabilityByEnd === null
                ? null
                : Math.round(forecast.probabilityByEnd * 100),
          },
    previous: previous
      ? {
          briefId: previous.id,
          sharedAt: (previous.sharedAt ?? previous.createdAt).toISOString(),
          percent: previous.facts.percent,
          forecastP85: previous.facts.forecastP85,
          risks: previous.facts.risks,
        }
      : null,
  };
  return { facts, snapshot };
}

export type BriefFacts = Awaited<ReturnType<typeof computeBriefFacts>>["facts"];

/** Every task the facts list: what the brief may cite. */
export function citableTasks(facts: BriefFacts): BriefTaskRef[] {
  const seen = new Map<string, BriefTaskRef>();
  for (const list of [
    facts.completed.tasks,
    facts.added.tasks,
    facts.removed.tasks,
    facts.inProgress.tasks,
    ...facts.risks.map((risk) => risk.tasks),
  ]) {
    for (const task of list) if (!seen.has(task.key)) seen.set(task.key, task);
  }
  return [...seen.values()];
}
