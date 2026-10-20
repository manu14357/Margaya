import { and, desc, eq, gte, inArray, isNull, or, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { type AiScope, assertProjectInScope } from "../ai/context";
import { truncateText, wrapUntrusted } from "../ai/prompt";
import { CYCLE_NOT_FOUND } from "../cycle/controllers/shared";
import db from "../database";
import {
  columnTable,
  cycleTable,
  cycleTaskTable,
  projectTable,
  taskAssigneeTable,
  taskRelationTable,
  taskTable,
  userTable,
} from "../database/schema";
import { getForecast } from "../delivery/forecast";
import { getScopeRisks } from "../delivery/risk";
import type { ScopeType } from "../delivery/scope";
import { PROJECT_NOT_FOUND } from "../project/visibility";
import {
  type TaskGroup,
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { UI_LOCALES, type UiLocale } from "./schema";

// What the summaries and spec drafts tell the model. Everything here is
// read for one caller and one AI scope: projects the caller can't see read
// as missing (404) and projects AI may not read answer AI_DISABLED, before
// any data is loaded. Text people wrote (titles, descriptions, names) goes
// inside <untrusted> blocks; numbers Margaya computed go outside them.

type PermissionCheck = (permissions: Record<string, string[]>) => boolean;

const DAY_MS = 86_400_000;
const RECENT_DAYS = 7;
const TASK_LINES = 120;

const GROUP_ORDER: Record<TaskGroup, number> = {
  started: 0,
  unstarted: 1,
  backlog: 2,
  triage: 3,
  completed: 4,
  cancelled: 5,
};

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  "no-priority": 4,
};

const GROUP_LABEL: Record<TaskGroup, string> = {
  backlog: "backlog",
  unstarted: "not started",
  started: "in progress",
  completed: "done",
  cancelled: "cancelled",
  triage: "triage",
};

export function taskKey(slug: string, number: number | null): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

function day(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return typeof date === "string"
    ? date.slice(0, 10)
    : date.toISOString().slice(0, 10);
}

/** The caller's answer language: the request's, else their saved one. */
export async function answerLocale(
  userId: string,
  requested: UiLocale | undefined,
): Promise<string> {
  if (requested) return requested;
  const [user] = await db
    .select({ locale: userTable.locale })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const saved = user?.locale ?? "";
  return (UI_LOCALES as readonly string[]).includes(saved) ? saved : "en-US";
}

type ScopeTaskRow = {
  id: string;
  key: string;
  title: string;
  group: TaskGroup;
  priority: string;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  addedAt: Date | null;
  assignees: string[];
};

async function assigneeNames(
  taskIds: string[],
): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  if (taskIds.length === 0) return names;
  const rows = await db
    .select({ taskId: taskAssigneeTable.taskId, name: userTable.name })
    .from(taskAssigneeTable)
    .innerJoin(userTable, eq(userTable.id, taskAssigneeTable.userId))
    .where(inArray(taskAssigneeTable.taskId, taskIds));
  for (const row of rows) {
    const list = names.get(row.taskId) ?? [];
    list.push(row.name);
    names.set(row.taskId, list);
  }
  return names;
}

/** The visible tasks of a cycle or a project, with their group. */
async function scopeTasks(input: {
  projectId: string;
  slug: string;
  cycleId?: string;
  limit: number;
}): Promise<{ rows: ScopeTaskRow[]; truncated: boolean }> {
  const columns = {
    id: taskTable.id,
    number: taskTable.number,
    title: taskTable.title,
    group: taskGroupSql,
    priority: taskTable.priority,
    dueDate: taskTable.dueDate,
    completedAt: taskTable.completedAt,
    createdAt: taskTable.createdAt,
  };
  const base = and(
    eq(taskTable.projectId, input.projectId),
    visibleTaskCondition,
  );
  const raw = input.cycleId
    ? await db
        .select({ ...columns, addedAt: cycleTaskTable.addedAt })
        .from(cycleTaskTable)
        .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
        .leftJoin(columnTable, taskColumnJoin)
        .where(and(eq(cycleTaskTable.cycleId, input.cycleId), base))
        .orderBy(desc(taskTable.updatedAt))
        .limit(input.limit + 1)
    : (
        await db
          .select(columns)
          .from(taskTable)
          .leftJoin(columnTable, taskColumnJoin)
          .where(
            and(
              base,
              // Old finished work says nothing about current health.
              or(
                isNull(taskTable.completedAt),
                gte(taskTable.completedAt, new Date(Date.now() - 30 * DAY_MS)),
              ) as SQL,
            ),
          )
          .orderBy(desc(taskTable.updatedAt))
          .limit(input.limit + 1)
      ).map((row) => ({ ...row, addedAt: null }));
  const truncated = raw.length > input.limit;
  const kept = raw.slice(0, input.limit);
  const names = await assigneeNames(kept.map((row) => row.id));
  return {
    truncated,
    rows: kept.map((row) => ({
      id: row.id,
      key: taskKey(input.slug, row.number),
      title: row.title,
      group: row.group,
      priority: row.priority,
      dueDate: row.dueDate,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      addedAt: row.addedAt,
      assignees: names.get(row.id) ?? [],
    })),
  };
}

function countLine(rows: ScopeTaskRow[], truncated: boolean): string {
  const counts: Record<TaskGroup, number> = {
    backlog: 0,
    unstarted: 0,
    started: 0,
    completed: 0,
    cancelled: 0,
    triage: 0,
  };
  for (const row of rows) counts[row.group] += 1;
  const total = rows.length;
  const done = counts.completed;
  const counted = total - counts.cancelled;
  const progress = counted > 0 ? Math.round((done / counted) * 100) : 0;
  return `Tasks${truncated ? " (most recently updated only)" : ""}: ${total} total; ${counts.backlog} backlog, ${counts.unstarted} not started, ${counts.started} in progress, ${done} done, ${counts.cancelled} cancelled; ${progress}% done.`;
}

function isOpen(row: ScopeTaskRow) {
  return (
    row.group === "backlog" ||
    row.group === "unstarted" ||
    row.group === "started"
  );
}

function taskLines(rows: ScopeTaskRow[], today: string): string {
  const sorted = [...rows].sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
  );
  return sorted
    .slice(0, TASK_LINES)
    .map((row) => {
      const due = day(row.dueDate);
      const facts = [
        GROUP_LABEL[row.group],
        `priority ${row.priority}`,
        due
          ? `due ${due}${isOpen(row) && due < today ? " (overdue)" : ""}`
          : null,
        row.assignees.length > 0
          ? `assigned to ${row.assignees.join(", ")}`
          : isOpen(row)
            ? "unassigned"
            : null,
      ].filter(Boolean);
      return `${row.key} [${facts.join("; ")}] ${truncateText(row.title, 200)}`;
    })
    .join("\n");
}

function recentLine(rows: ScopeTaskRow[], now: Date, cycle: boolean): string {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const completed = rows.filter(
    (row) =>
      row.completedAt && row.completedAt >= since && row.group === "completed",
  );
  const added = rows.filter((row) =>
    cycle ? row.addedAt && row.addedAt >= since : row.createdAt >= since,
  );
  const keys = (list: ScopeTaskRow[]) =>
    list.length > 0
      ? ` (${list
          .slice(0, 15)
          .map((row) => row.key)
          .join(", ")})`
      : "";
  return `In the last ${RECENT_DAYS} days: ${completed.length} completed${keys(completed)}; ${added.length} ${cycle ? "added to the cycle" : "created"}${keys(added)}.`;
}

/**
 * The forecast and risk radar lines (A2, A3), when the caller may read
 * analytics; a slow computation is left out rather than failing the summary.
 */
async function deliveryLines(
  type: ScopeType,
  id: string,
  userId: string,
  keyOf: (taskId: string) => string | null,
  can: PermissionCheck,
): Promise<string[]> {
  if (!can({ analytics: ["read"], task: ["read"] })) return [];
  const lines: string[] = [];
  const [forecast, risks] = await Promise.allSettled([
    getForecast(type, id),
    getScopeRisks(type, id, userId),
  ]);
  if (forecast.status === "fulfilled") {
    const f = forecast.value;
    if (f.status === "ok") {
      const byEnd =
        f.probabilityByEnd === null
          ? ""
          : `; chance of finishing by the end date: ${Math.round(f.probabilityByEnd * 100)}%`;
      lines.push(
        `Forecast (Monte Carlo on the last weeks' throughput, ${f.remaining} open tasks): 50% likely done by ${f.p50 ?? "beyond the horizon"}, 85% by ${f.p85 ?? "beyond the horizon"}, 95% by ${f.p95 ?? "beyond the horizon"}${byEnd}.`,
      );
    } else if (f.status === "complete") {
      lines.push("Forecast: no open tasks left.");
    } else {
      lines.push("Forecast: not enough completion history to forecast yet.");
    }
  }
  if (risks.status === "fulfilled") {
    const r = risks.value;
    // Only tasks the caller can see are named (the radar drops the rest).
    const named = new Map(
      r.tasks.map((task) => [task.id, taskKey(task.projectSlug, task.number)]),
    );
    const keysOf = (ids: string[]) =>
      ids
        .map((taskId) => named.get(taskId) ?? keyOf(taskId))
        .filter((key): key is string => Boolean(key))
        .slice(0, 8);
    if (r.signals.length === 0) {
      lines.push("Risk radar: no risks detected.");
    } else {
      lines.push("Risk radar:");
      for (const signal of r.signals.slice(0, 10)) {
        const keys = keysOf([
          ...(signal.headTaskId ? [signal.headTaskId] : []),
          ...signal.taskIds,
        ]);
        const extra = [
          signal.ageDays !== undefined
            ? `${signal.ageDays} days in progress`
            : null,
          signal.depth !== undefined ? `chain depth ${signal.depth}` : null,
          signal.deadline ? `deadline ${signal.deadline}` : null,
        ].filter(Boolean);
        lines.push(
          `- ${signal.severity} ${signal.kind.replaceAll("_", " ")}: ${signal.total} task(s)${keys.length > 0 ? ` (${[...new Set(keys)].join(", ")})` : ""}${extra.length > 0 ? `; ${extra.join("; ")}` : ""}`,
        );
      }
    }
    if (r.criticalPath && r.criticalPath.finishDate) {
      lines.push(
        `Critical path: ${r.criticalPath.total} ${r.criticalPath.unit}, projected to finish ${r.criticalPath.finishDate}${r.criticalPath.slackDays === null ? "" : ` (slack ${r.criticalPath.slackDays} days)`}.`,
      );
    }
  }
  return lines;
}

export type SummaryPrompt = {
  projectId: string;
  /** The message body: computed facts plus untrusted blocks. */
  text: string;
};

async function projectRow(projectId: string, workspaceId: string) {
  const [project] = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      description: projectTable.description,
      workspaceId: projectTable.workspaceId,
      cyclesEnabled: projectTable.cyclesEnabled,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project || project.workspaceId !== workspaceId || project.deletedAt) {
    return null;
  }
  return project;
}

export async function cycleSummaryPrompt(
  scope: AiScope,
  cycleId: string,
  can: PermissionCheck,
  now = new Date(),
): Promise<SummaryPrompt> {
  const [cycle] = await db
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      description: cycleTable.description,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
      projectId: cycleTable.projectId,
      archivedAt: cycleTable.archivedAt,
      owner: userTable.name,
    })
    .from(cycleTable)
    .leftJoin(userTable, eq(userTable.id, cycleTable.ownerId))
    .where(eq(cycleTable.id, cycleId))
    .limit(1);
  const project = cycle
    ? await projectRow(cycle.projectId, scope.workspaceId)
    : null;
  if (!cycle || !project) {
    throw new HTTPException(404, { message: CYCLE_NOT_FOUND });
  }
  if (
    !scope.projectIds.has(project.id) &&
    !scope.excludedProjectIds.has(project.id)
  ) {
    // Hidden from the caller: the cycle reads as missing.
    throw new HTTPException(404, { message: CYCLE_NOT_FOUND });
  }
  if (!can({ cycle: ["read"], task: ["read"] })) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  if (!project.cyclesEnabled) {
    throw new HTTPException(403, {
      message: "The Cycles feature is turned off for this project.",
    });
  }
  assertProjectInScope(scope, project.id);

  const today = day(now) as string;
  const { rows, truncated } = await scopeTasks({
    projectId: project.id,
    slug: project.slug,
    cycleId: cycle.id,
    limit: 400,
  });
  const keys = new Map(rows.map((row) => [row.id, row.key]));
  const start = cycle.startDate;
  const end = cycle.endDate;
  const timing =
    start && end
      ? `Dates: ${start} to ${end}; today is ${today}${today > end ? " (the cycle has ended)" : today < start ? " (not started yet)" : ` (day ${Math.floor((Date.parse(today) - Date.parse(start)) / DAY_MS) + 1} of ${Math.floor((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1})`}.`
      : "Dates: not set.";
  const computed = [
    timing,
    cycle.archivedAt ? "The cycle is archived." : null,
    countLine(rows, truncated),
    recentLine(rows, now, true),
    ...(await deliveryLines(
      "cycle",
      cycle.id,
      scope.userId,
      (id) => keys.get(id) ?? null,
      can,
    )),
  ].filter(Boolean);

  const text = [
    "Summarize this cycle: overall progress, risks and blockers, and notable changes. End with what needs attention next.",
    `Computed by Margaya:\n${computed.join("\n")}`,
    wrapUntrusted({
      source: `cycle:${cycle.name}`,
      text: [
        `Cycle: ${cycle.name}`,
        `Project: ${project.name} (${project.slug.toUpperCase()})`,
        cycle.owner ? `Owner: ${cycle.owner}` : null,
        cycle.description ? `Description:\n${cycle.description}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      maxChars: 4000,
    }),
    wrapUntrusted({
      source: `cycle-tasks:${cycle.name}`,
      text: rows.length > 0 ? taskLines(rows, today) : "(no tasks)",
      maxChars: 24_000,
    }),
  ].join("\n\n");
  return { projectId: project.id, text };
}

export async function projectSummaryPrompt(
  scope: AiScope,
  projectId: string,
  can: PermissionCheck,
  now = new Date(),
): Promise<SummaryPrompt> {
  const project = await projectRow(projectId, scope.workspaceId);
  if (!project) throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
  assertProjectInScope(scope, project.id);
  if (!can({ task: ["read"] })) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }

  const today = day(now) as string;
  const { rows, truncated } = await scopeTasks({
    projectId: project.id,
    slug: project.slug,
    limit: 400,
  });
  const keys = new Map(rows.map((row) => [row.id, row.key]));
  const cycles = project.cyclesEnabled
    ? await db
        .select({
          name: cycleTable.name,
          startDate: cycleTable.startDate,
          endDate: cycleTable.endDate,
        })
        .from(cycleTable)
        .where(
          and(
            eq(cycleTable.projectId, project.id),
            isNull(cycleTable.archivedAt),
          ),
        )
    : [];
  const current = cycles.filter(
    (cycle) =>
      cycle.startDate &&
      cycle.endDate &&
      cycle.startDate <= today &&
      cycle.endDate >= today,
  );
  const overdue = rows.filter((row) => {
    const due = day(row.dueDate);
    return isOpen(row) && due !== null && due < today;
  }).length;
  const unassigned = rows.filter(
    (row) => isOpen(row) && row.assignees.length === 0,
  ).length;
  const computed = [
    `Today is ${today}.`,
    `${countLine(rows, truncated)} (Open work plus what finished in the last 30 days.)`,
    `Open tasks overdue: ${overdue}; open tasks unassigned: ${unassigned}.`,
    recentLine(rows, now, false),
    ...(await deliveryLines(
      "project",
      project.id,
      scope.userId,
      (id) => keys.get(id) ?? null,
      can,
    )),
  ];

  const text = [
    "Summarize this project's status and health: where it stands, what is moving, what is stuck or at risk, and what needs attention next.",
    `Computed by Margaya:\n${computed.join("\n")}`,
    wrapUntrusted({
      source: `project:${project.slug.toUpperCase()}`,
      text: [
        `Project: ${project.name} (${project.slug.toUpperCase()})`,
        project.description ? `Description:\n${project.description}` : null,
        current.length > 0
          ? `Current cycles: ${current.map((cycle) => `${cycle.name} (${cycle.startDate} to ${cycle.endDate})`).join("; ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
      maxChars: 4000,
    }),
    wrapUntrusted({
      source: `project-tasks:${project.slug.toUpperCase()}`,
      text: rows.length > 0 ? taskLines(rows, today) : "(no tasks)",
      maxChars: 24_000,
    }),
  ].join("\n\n");
  return { projectId: project.id, text };
}

/**
 * Related work for a spec draft: the task's relations (parent, subtasks,
 * blockers, related tasks) in projects AI may read for this caller.
 */
export async function relatedTaskLines(
  scope: AiScope,
  taskId: string,
): Promise<string> {
  const relations = await db
    .select({
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
      type: taskRelationTable.relationType,
    })
    .from(taskRelationTable)
    .where(
      or(
        eq(taskRelationTable.sourceTaskId, taskId),
        eq(taskRelationTable.targetTaskId, taskId),
      ),
    )
    .limit(40);
  const otherIds = relations.map((relation) =>
    relation.sourceTaskId === taskId
      ? relation.targetTaskId
      : relation.sourceTaskId,
  );
  if (otherIds.length === 0) return "";
  const tasks = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      title: taskTable.title,
      status: taskTable.status,
      slug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        inArray(taskTable.id, otherIds),
        isNull(taskTable.deletedAt),
        eq(projectTable.workspaceId, scope.workspaceId),
      ),
    );
  const byId = new Map(
    tasks
      .filter((task) => scope.projectIds.has(task.projectId))
      .map((task) => [task.id, task]),
  );
  const lines: string[] = [];
  for (const relation of relations) {
    const outgoing = relation.sourceTaskId === taskId;
    const other = byId.get(
      outgoing ? relation.targetTaskId : relation.sourceTaskId,
    );
    if (!other) continue;
    const label =
      relation.type === "subtask"
        ? outgoing
          ? "subtask"
          : "parent"
        : relation.type === "blocks"
          ? outgoing
            ? "blocks"
            : "blocked by"
          : relation.type.replaceAll("_", " ");
    lines.push(
      `${label}: ${taskKey(other.slug, other.number)} [${other.status}] ${truncateText(other.title, 200)}`,
    );
  }
  return lines.join("\n");
}
