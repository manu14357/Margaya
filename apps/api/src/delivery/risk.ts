import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  type AnalyticsCaller,
  analyticsRead,
  loadAnalyticsContext,
} from "../analytics/scope";
import type { ColumnGroup } from "../column/groups";
import {
  columnTable,
  cycleTable,
  projectTable,
  taskAssigneeTable,
  taskRelationTable,
  taskTable,
} from "../database/schema";
import { hiddenProjectIds } from "../project/visibility";
import type { Reader } from "../task/progress-queries";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { localDateString, todayInTimezone } from "../utils/zoned-date";
import { cycleTimeStats, loadTaskFlows } from "./flow-history";
import type { Edge } from "./risk-graph";
import {
  type CycleTimeStats,
  computeRisks,
  type RiskSignal,
  type RiskTask,
} from "./risk-signals";
import {
  type DeliveryScope,
  openScopeTaskIds,
  resolveScope,
  type ScopeType,
} from "./scope";

// Risk radar (A3): loads the scope's open tasks, walks their open blockers
// upward, and hands everything to the pure signal builder. Tasks in projects
// the caller can't see (restricted, or another workspace) stay in the graph
// but are never returned by id, title or number.

export const SCOPE_TASK_LIMIT = 2000;
export const GRAPH_NODE_LIMIT = 5000;
export const GRAPH_DEPTH_LIMIT = 50;
export const HOME_CYCLE_LIMIT = 20;
export const HOME_SIGNAL_LIMIT = 8;

const PRECEDENCE_TYPES = ["blocks", "finish_before"] as const;
const OPEN_GROUPS = sql`${taskGroupSql} in ('backlog', 'unstarted', 'started')`;

type TaskRow = {
  id: string;
  projectId: string;
  workspaceId: string;
  projectSlug: string;
  number: number | null;
  title: string;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  group: ColumnGroup;
};

async function loadTasks(reader: Reader, ids: readonly string[]) {
  if (ids.length === 0) return [] as TaskRow[];
  return reader
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
      projectSlug: projectTable.slug,
      number: taskTable.number,
      title: taskTable.title,
      status: taskTable.status,
      dueDate: taskTable.dueDate,
      createdAt: taskTable.createdAt,
      completedAt: taskTable.completedAt,
      group: taskGroupSql,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        inArray(taskTable.id, [...ids]),
        visibleTaskCondition,
        isNull(projectTable.deletedAt),
      ),
    ) as Promise<TaskRow[]>;
}

/** Open blockers reached upward from the scope, with the edges between. */
async function loadBlockerGraph(reader: Reader, scopeIds: readonly string[]) {
  const nodes = new Set(scopeIds);
  const blockEdges: Edge[] = [];
  const finishEdges: Edge[] = [];
  let frontier = [...scopeIds];
  let truncated = false;
  for (let depth = 0; frontier.length > 0; depth++) {
    if (depth >= GRAPH_DEPTH_LIMIT) {
      truncated = true;
      break;
    }
    const rows = await reader
      .select({
        from: taskRelationTable.sourceTaskId,
        to: taskRelationTable.targetTaskId,
        type: taskRelationTable.relationType,
      })
      .from(taskRelationTable)
      .innerJoin(taskTable, eq(taskTable.id, taskRelationTable.sourceTaskId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(
        and(
          inArray(taskRelationTable.targetTaskId, frontier),
          inArray(taskRelationTable.relationType, [...PRECEDENCE_TYPES]),
          visibleTaskCondition,
          OPEN_GROUPS,
        ),
      );
    const next: string[] = [];
    for (const row of rows) {
      (row.type === "blocks" ? blockEdges : finishEdges).push({
        from: row.from,
        to: row.to,
      });
      if (nodes.has(row.from)) continue;
      if (nodes.size >= GRAPH_NODE_LIMIT) {
        truncated = true;
        continue;
      }
      nodes.add(row.from);
      next.push(row.from);
    }
    frontier = next;
  }
  return { nodes: [...nodes], blockEdges, finishEdges, truncated };
}

async function assigneesOf(reader: Reader, ids: readonly string[]) {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await reader
    .select({
      taskId: taskAssigneeTable.taskId,
      userId: taskAssigneeTable.userId,
    })
    .from(taskAssigneeTable)
    .where(inArray(taskAssigneeTable.taskId, [...ids]))
    .orderBy(taskAssigneeTable.position);
  for (const row of rows) {
    map.set(row.taskId, [...(map.get(row.taskId) ?? []), row.userId]);
  }
  return map;
}

/** Start of the current in-progress stint of each started task. */
async function startedAtOf(reader: Reader, rows: readonly TaskRow[]) {
  const map = new Map<string, Date>();
  const byProject = new Map<string, TaskRow[]>();
  for (const row of rows) {
    if (row.group !== "started") continue;
    byProject.set(row.projectId, [
      ...(byProject.get(row.projectId) ?? []),
      row,
    ]);
  }
  for (const [projectId, list] of byProject) {
    for (const task of await loadTaskFlows(reader, projectId, list)) {
      if (task.flow.currentStartedAt) {
        map.set(task.id, task.flow.currentStartedAt);
      }
    }
  }
  return map;
}

export type RiskTaskRef = {
  id: string;
  projectId: string;
  projectSlug: string;
  number: number | null;
  title: string;
  status: string;
  dueDate: Date | null;
  assigneeIds: string[];
};

export type ScopeRisks = {
  scope: {
    type: ScopeType;
    id: string;
    projectId: string;
    endDate: string | null;
  };
  today: string;
  truncated: boolean;
  hiddenBlockers: number;
  history: { cycleTime: CycleTimeStats };
  criticalPath: ReturnType<typeof computeRisks>["criticalPath"];
  signals: RiskSignal[];
  tasks: RiskTaskRef[];
};

export async function computeScopeRisks(
  reader: Reader,
  scope: DeliveryScope,
  userId: string,
  now: Date = new Date(),
  cycleTimeCache?: Map<string, CycleTimeStats>,
): Promise<ScopeRisks> {
  const today = todayInTimezone(scope.timeZone, now);
  const scopeAll = await openScopeTaskIds(reader, scope, SCOPE_TASK_LIMIT + 1);
  const scopeIds = scopeAll.slice(0, SCOPE_TASK_LIMIT);
  const graph = await loadBlockerGraph(reader, scopeIds);
  const rows = await loadTasks(reader, graph.nodes);
  const hidden = new Set(await hiddenProjectIds(userId, scope.workspaceId));
  const isHidden = (row: TaskRow) =>
    row.workspaceId !== scope.workspaceId || hidden.has(row.projectId);
  const assignees = await assigneesOf(
    reader,
    rows.filter((row) => !isHidden(row)).map((row) => row.id),
  );
  const startedAt = await startedAtOf(reader, rows);
  let cycleTime = cycleTimeCache?.get(scope.projectId);
  if (!cycleTime) {
    cycleTime = await cycleTimeStats(reader, scope.projectId, now);
    cycleTimeCache?.set(scope.projectId, cycleTime);
  }

  const tasks = new Map<string, RiskTask>();
  const byId = new Map<string, TaskRow>();
  for (const row of rows) {
    byId.set(row.id, row);
    tasks.set(row.id, {
      id: row.id,
      group: row.group,
      dueDay: row.dueDate ? localDateString(row.dueDate, scope.timeZone) : null,
      assigneeIds: assignees.get(row.id) ?? [],
      startedAt: startedAt.get(row.id) ?? null,
      hidden: isHidden(row),
    });
  }
  const present = (edge: Edge) => tasks.has(edge.from) && tasks.has(edge.to);
  const result = computeRisks({
    today,
    now,
    endDate: scope.endDate,
    scopeIds: scopeIds.filter((id) => tasks.has(id)),
    tasks,
    blockEdges: graph.blockEdges.filter(present),
    finishEdges: graph.finishEdges.filter(present),
    cycleTime,
  });

  const referenced = new Set<string>();
  for (const signal of result.signals) {
    for (const id of signal.taskIds) referenced.add(id);
    if (signal.headTaskId) referenced.add(signal.headTaskId);
  }
  for (const id of result.criticalPath?.taskIds ?? []) referenced.add(id);
  const taskRefs: RiskTaskRef[] = [];
  for (const id of referenced) {
    const row = byId.get(id);
    if (!row || isHidden(row)) continue;
    taskRefs.push({
      id: row.id,
      projectId: row.projectId,
      projectSlug: row.projectSlug,
      number: row.number,
      title: row.title,
      status: row.status,
      dueDate: row.dueDate,
      assigneeIds: assignees.get(row.id) ?? [],
    });
  }

  return {
    scope: {
      type: scope.type,
      id: scope.id,
      projectId: scope.projectId,
      endDate: scope.endDate,
    },
    today,
    truncated: scopeAll.length > SCOPE_TASK_LIMIT || graph.truncated,
    hiddenBlockers: rows.filter(isHidden).length,
    history: { cycleTime },
    criticalPath: result.criticalPath,
    signals: result.signals,
    tasks: taskRefs,
  };
}

export function getScopeRisks(type: ScopeType, id: string, userId: string) {
  return analyticsRead(async (tx) =>
    computeScopeRisks(tx, await resolveScope(tx, type, id), userId),
  );
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * Home: the top risks across the caller's current cycles (projects they can
 * see, with cycles on), latest started first.
 */
export function getHomeRisks(caller: AnalyticsCaller) {
  return analyticsRead(async (tx) => {
    const context = await loadAnalyticsContext(tx, caller);
    const projects = context.projects.filter(
      (project) => project.cyclesEnabled,
    );
    const today = context.utcToday;
    const cycles =
      projects.length === 0
        ? []
        : await tx
            .select({
              id: cycleTable.id,
              name: cycleTable.name,
              projectId: cycleTable.projectId,
            })
            .from(cycleTable)
            .where(
              and(
                inArray(
                  cycleTable.projectId,
                  projects.map((project) => project.id),
                ),
                isNull(cycleTable.archivedAt),
                lte(cycleTable.startDate, today),
                gte(cycleTable.endDate, today),
              ),
            )
            .orderBy(desc(cycleTable.startDate), cycleTable.id)
            .limit(HOME_CYCLE_LIMIT);

    const cache = new Map<string, CycleTimeStats>();
    const entries: Array<
      RiskSignal & {
        projectId: string;
        projectName: string;
        cycleId: string;
        cycleName: string;
      }
    > = [];
    const taskById = new Map<string, RiskTaskRef>();
    for (const cycle of cycles) {
      const scope = await resolveScope(tx, "cycle", cycle.id);
      const risks = await computeScopeRisks(
        tx,
        scope,
        caller.userId,
        new Date(),
        cache,
      );
      const project = context.projectById.get(cycle.projectId);
      for (const signal of risks.signals) {
        entries.push({
          ...signal,
          projectId: cycle.projectId,
          projectName: project?.name ?? "",
          cycleId: cycle.id,
          cycleName: cycle.name,
        });
      }
      for (const task of risks.tasks) taskById.set(task.id, task);
    }
    entries.sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.total - a.total,
    );
    const signals = entries.slice(0, HOME_SIGNAL_LIMIT);
    const wanted = new Set<string>();
    for (const signal of signals) {
      for (const id of signal.taskIds) wanted.add(id);
      if (signal.headTaskId) wanted.add(signal.headTaskId);
    }
    return {
      today,
      cycles: cycles.length,
      signals,
      tasks: [...wanted]
        .map((id) => taskById.get(id))
        .filter((task): task is RiskTaskRef => Boolean(task)),
    };
  });
}
