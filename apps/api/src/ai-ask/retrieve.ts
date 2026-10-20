import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AiContextItem, AiScope } from "../ai/context";
import { filterToScope, projectDataTier } from "../ai/context";
import { truncateText } from "../ai/prompt";
import { hybridSearchWorkspace } from "../ai-memory/semantic-search";
import { OPEN_COLUMN_GROUPS } from "../column/groups";
import db from "../database";
import {
  activityTable,
  columnTable,
  cycleTable,
  cycleTaskTable,
  pageTable,
  projectTable,
  taskAssigneeTable,
  taskRelationTable,
  taskTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import { getForecast } from "../delivery/forecast";
import { getScopeRisks } from "../delivery/risk";
import {
  searchWorkspace,
  type WorkspaceSearchType,
} from "../search/search-workspace";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { runTaskQuery } from "../task-query/run";
import type { FilterCondition } from "../task-query/schema";
import { MAX_SCOPE_PROJECTS } from "../task-query/schema";
import { resolveTimezone } from "../utils/zoned-date";
import { factsItem, loadAskFacts } from "./facts";
import {
  type AskPlan,
  matchCycle,
  matchMembers,
  matchProject,
  nameWords,
  searchQueryOf,
  searchTermsOf,
} from "./plan";
import type { AskSource } from "./response";
import {
  formatTrend,
  loadCycleBurn,
  loadTrend,
  trendItem,
  trendUnitOf,
} from "./trend";

// Retrieval for Ask. Every read is limited to the AI scope (projects the
// caller can see and AI may read), and the assembled items go through
// filterToScope once more before anything reaches a prompt.

/** A context item with the citation token the answer uses for it. */
export type AskItem = AiContextItem & {
  /**
   * "T:WEB-12", "P:Roadmap", "C:WEB-12/ab12cd", "W:1" (a web result); null
   * for computed facts, memory notes and attached files.
   */
  ref: string | null;
  updatedAt: Date | null;
};

export const MAX_STRUCTURED_TASKS = 25;
export const MAX_SEARCH_HITS = 15;
export const MAX_ASK_ITEMS = 40;

/** Workspace members read to match names in a question ("Mia's tasks"). */
export const MAX_MEMBERS_SCANNED = 2_000;

const STRUCTURED_INTENTS = new Set([
  "overdue",
  "mine",
  "open",
  "completed",
  "blocking",
  "due_soon",
  "unassigned",
  "high_priority",
  "recent",
]);

type ScopeProject = {
  id: string;
  name: string;
  slug: string;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
};

type Retrieval = {
  scope: AiScope;
  plan: AskPlan;
  question: string;
  /** The project Ask was opened in: everything comes from it. */
  projectId: string | null;
  now: Date;
  /** Forecasts and risks need analytics:read, as on the delivery routes. */
  canReadAnalytics: boolean;
};

function taskKey(slug: string, number: number | null): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

function taskUrl(workspaceId: string, projectId: string, taskId: string) {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`;
}

/** Brackets would end the citation token early. */
export function refText(text: string): string {
  return text
    .replace(/[[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function day(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

async function scopeProjects(scope: AiScope): Promise<ScopeProject[]> {
  const ids = [...scope.projectIds];
  if (ids.length === 0) return [];
  return db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
    })
    .from(projectTable)
    .where(inArray(projectTable.id, ids))
    .orderBy(asc(projectTable.position));
}

async function scopeCycles(projectIds: string[]) {
  if (projectIds.length === 0) return [];
  return (
    db
      .select({
        id: cycleTable.id,
        name: cycleTable.name,
        projectId: cycleTable.projectId,
        startDate: cycleTable.startDate,
        endDate: cycleTable.endDate,
      })
      .from(cycleTable)
      .where(inArray(cycleTable.projectId, projectIds))
      // Live cycles before archived ones with the same name.
      .orderBy(
        sql`${cycleTable.archivedAt} is not null`,
        asc(cycleTable.sortOrder),
      )
  );
}

export async function workspaceTimeZone(workspaceId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: workspaceTable.timezone })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  return resolveTimezone(row?.timezone);
}

/** People and agents of the workspace, for name matching (bounded). */
async function workspaceMembers(workspaceId: string) {
  return db
    .select({ id: userTable.id, name: userTable.name, kind: userTable.kind })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(eq(workspaceUserTable.workspaceId, workspaceId))
    .limit(MAX_MEMBERS_SCANNED);
}

// Intents that only make sense for open work: their empty result is final.
const OPEN_INTENTS = new Set(["open", "overdue", "due_soon", "blocking"]);

// Asked about a task by key ("is WEB-4 done?"), these intents describe the
// named task; its status answers them without listing every finished task.
const STATUS_INTENTS = new Set(["open", "completed"]);

export type StructuredQuery = {
  conditions: FilterCondition[];
  orderBy: "dueDate" | "completedAt" | "updatedAt";
  /**
   * Open work was assumed, not asked for ("Mia's tasks"): when nothing is
   * open, the same query over every status shows the finished work.
   */
  openByDefault: boolean;
};

/** The task-query filters a plan asks for, or null when it asks for none. */
export function structuredFilters(
  plan: AskPlan,
  options: {
    cycleId?: string | null;
    assigneeIds?: readonly string[];
    /** Tasks the question names by key (or carries over). */
    keyed?: boolean;
  } = {},
): StructuredQuery | null {
  const intents = plan.intents;
  const cycleId = options.cycleId ?? null;
  const assigneeIds = options.assigneeIds ?? [];
  const asked = [...intents].filter((intent) => STRUCTURED_INTENTS.has(intent));
  if (asked.length === 0 && !cycleId && assigneeIds.length === 0) return null;
  if (
    options.keyed &&
    !cycleId &&
    assigneeIds.length === 0 &&
    asked.every((intent) => STATUS_INTENTS.has(intent))
  ) {
    return null;
  }
  const conditions: FilterCondition[] = [];
  if (intents.has("overdue")) {
    conditions.push({ key: "dueDate", operator: "in", values: ["past"] });
  }
  if (intents.has("due_soon")) {
    conditions.push({
      key: "dueDate",
      operator: "withinNext",
      amount: 7,
      unit: "days",
    });
  }
  if (intents.has("mine") || assigneeIds.length > 0) {
    conditions.push({
      key: "assignee",
      operator: "in",
      values: [...(intents.has("mine") ? ["me"] : []), ...assigneeIds],
    });
  } else if (intents.has("unassigned")) {
    conditions.push({ key: "assignee", operator: "in", values: ["none"] });
  }
  if (intents.has("high_priority")) {
    conditions.push({
      key: "priority",
      operator: "in",
      values: ["urgent", "high"],
    });
  }
  if (cycleId) {
    conditions.push({ key: "cycle", operator: "in", values: [cycleId] });
  }
  const completed = intents.has("completed");
  const open = asked.some((intent) => OPEN_INTENTS.has(intent));
  // Only "what changed recently" looks at work of every status.
  const onlyRecent =
    asked.length === 1 &&
    asked[0] === "recent" &&
    !cycleId &&
    assigneeIds.length === 0;
  let openByDefault = false;
  if (completed && !open) {
    conditions.push({ key: "group", operator: "in", values: ["completed"] });
  } else if (!completed && !onlyRecent) {
    conditions.push({
      key: "group",
      operator: "in",
      values: [...OPEN_COLUMN_GROUPS],
    });
    openByDefault = !open;
  }
  return {
    conditions,
    orderBy:
      intents.has("overdue") || intents.has("due_soon")
        ? "dueDate"
        : completed && !open
          ? "completedAt"
          : "updatedAt",
    openByDefault,
  };
}

/** The same query without the assumed open-work filter. */
export function withoutDefaultGroup(query: StructuredQuery): StructuredQuery {
  return {
    ...query,
    conditions: query.conditions.filter(
      (condition) => condition.key !== "group",
    ),
    openByDefault: false,
  };
}

async function structuredTaskIds(
  input: Retrieval,
  projectIds: string[],
  query: Pick<StructuredQuery, "conditions" | "orderBy">,
): Promise<string[]> {
  if (projectIds.length === 0 || !input.scope.can.readTasks) return [];
  const { conditions, orderBy } = query;
  const result = await runTaskQuery(
    {
      workspaceId: input.scope.workspaceId,
      scope: { projectIds: projectIds.slice(0, MAX_SCOPE_PROJECTS) },
      // "What changed recently" has no conditions; an empty group is invalid.
      filters:
        conditions.length > 0 ? { op: "and", children: conditions } : null,
      display: {
        orderBy:
          orderBy === "dueDate"
            ? { field: "dueDate", direction: "asc" }
            : { field: orderBy, direction: "desc" },
      },
      page: { limit: MAX_STRUCTURED_TASKS },
      mode: "rows",
      context: { timeZone: await workspaceTimeZone(input.scope.workspaceId) },
    },
    { workspaceId: input.scope.workspaceId, userId: input.scope.userId },
  );
  return result.groups.flatMap((group) => group.taskIds ?? []);
}

/** Open "blocks" edges touching these tasks: blocker → blocked. */
async function blockEdges(taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return db
    .select({
      from: taskRelationTable.sourceTaskId,
      to: taskRelationTable.targetTaskId,
    })
    .from(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.relationType, "blocks"),
        or(
          inArray(taskRelationTable.targetTaskId, taskIds),
          inArray(taskRelationTable.sourceTaskId, taskIds),
        ),
      ),
    )
    .limit(200);
}

export type TaskRow = {
  id: string;
  projectId: string;
  projectName: string;
  key: string;
  title: string;
  description: string | null;
  column: string | null;
  status: string;
  group: string;
  priority: string;
  dueDate: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  assignees: string[];
  cycle: string | null;
};

export async function loadTasks(
  scope: AiScope,
  ids: string[],
): Promise<Map<string, TaskRow>> {
  const map = new Map<string, TaskRow>();
  const projectIds = [...scope.projectIds];
  if (ids.length === 0 || projectIds.length === 0 || !scope.can.readTasks) {
    return map;
  }
  const rows = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      projectName: projectTable.name,
      slug: projectTable.slug,
      number: taskTable.number,
      title: taskTable.title,
      description: taskTable.description,
      column: columnTable.name,
      status: taskTable.status,
      group: taskGroupSql,
      priority: taskTable.priority,
      dueDate: taskTable.dueDate,
      completedAt: taskTable.completedAt,
      updatedAt: taskTable.updatedAt,
      cycle: cycleTable.name,
      cyclesEnabled: projectTable.cyclesEnabled,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .leftJoin(cycleTaskTable, eq(cycleTaskTable.taskId, taskTable.id))
    .leftJoin(cycleTable, eq(cycleTable.id, cycleTaskTable.cycleId))
    .where(
      and(
        inArray(taskTable.id, ids),
        inArray(taskTable.projectId, projectIds),
        eq(projectTable.workspaceId, scope.workspaceId),
        visibleTaskCondition,
      ),
    );
  const assignees = rows.length
    ? await db
        .select({ taskId: taskAssigneeTable.taskId, name: userTable.name })
        .from(taskAssigneeTable)
        .innerJoin(userTable, eq(userTable.id, taskAssigneeTable.userId))
        .where(
          inArray(
            taskAssigneeTable.taskId,
            rows.map((row) => row.id),
          ),
        )
    : [];
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      projectId: row.projectId,
      projectName: row.projectName,
      key: taskKey(row.slug, row.number),
      title: row.title,
      description: row.description,
      column: row.column,
      status: row.status,
      group: row.group,
      priority: row.priority,
      dueDate: row.dueDate,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
      // Cycles of a project with cycles off read as none, as in task queries.
      cycle: row.cyclesEnabled ? row.cycle : null,
      assignees: assignees
        .filter((assignee) => assignee.taskId === row.id)
        .map((assignee) => assignee.name),
    });
  }
  return map;
}

function isOpen(group: string): boolean {
  return (OPEN_COLUMN_GROUPS as readonly string[]).includes(group);
}

export function taskItem(
  scope: AiScope,
  task: TaskRow,
  today: string,
  relations: { blockedBy: TaskRow[]; blocks: TaskRow[] },
  options: { describe: boolean },
): AskItem {
  const due = day(task.dueDate);
  const overdue = due !== null && due < today && isOpen(task.group);
  const list = (tasks: TaskRow[]) =>
    tasks.map((other) => `${other.key} ${other.title}`).join("; ");
  const facts = [
    `Task: ${task.key} ${task.title}`,
    `Project: ${task.projectName}`,
    `Status: ${task.column ?? task.status} (${task.group})`,
    `Priority: ${task.priority}`,
    due ? `Due: ${due}${overdue ? " (overdue)" : ""}` : null,
    task.group === "completed" && task.completedAt
      ? `Completed: ${day(task.completedAt)}`
      : null,
    `Assignees: ${task.assignees.length ? task.assignees.join(", ") : "none"}`,
    task.cycle ? `Cycle: ${task.cycle}` : null,
    relations.blockedBy.length
      ? `Blocked by (open): ${list(relations.blockedBy)}`
      : null,
    relations.blocks.length ? `Blocks: ${list(relations.blocks)}` : null,
    `Last updated: ${day(task.updatedAt)}`,
    options.describe && task.description
      ? `Description:\n${truncateText(task.description, 1500)}`
      : null,
  ].filter(Boolean);
  const ref = `T:${task.key}`;
  return {
    kind: "task",
    id: task.id,
    projectId: task.projectId,
    title: `${task.key} ${task.title}`,
    url: taskUrl(scope.workspaceId, task.projectId, task.id),
    source: ref,
    author: null,
    text: facts.join("\n"),
    dataTier: projectDataTier(scope, task.projectId),
    ref,
    updatedAt: task.updatedAt,
  };
}

async function loadPages(scope: AiScope, ids: string[]): Promise<AskItem[]> {
  const projectIds = [...scope.projectIds];
  if (ids.length === 0 || projectIds.length === 0 || !scope.can.readPages) {
    return [];
  }
  const rows = await db
    .select({
      id: pageTable.id,
      projectId: pageTable.projectId,
      title: pageTable.title,
      text: pageTable.contentText,
      updatedAt: pageTable.updatedAt,
    })
    .from(pageTable)
    .innerJoin(projectTable, eq(projectTable.id, pageTable.projectId))
    .where(
      and(
        inArray(pageTable.id, ids),
        eq(pageTable.workspaceId, scope.workspaceId),
        inArray(pageTable.projectId, projectIds),
        isNull(pageTable.archivedAt),
        eq(projectTable.pagesEnabled, true),
        or(eq(pageTable.access, "public"), eq(pageTable.ownerId, scope.userId)),
      ),
    );
  const order = new Map(ids.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const used = new Map<string, number>();
  return rows.flatMap((row) => {
    if (!row.projectId) return [];
    const title = refText(row.title || "Untitled") || "Untitled";
    const seen = (used.get(title) ?? 0) + 1;
    used.set(title, seen);
    const ref = `P:${seen > 1 ? `${title} (${seen})` : title}`;
    return [
      {
        kind: "page" as const,
        id: row.id,
        projectId: row.projectId,
        title: row.title || "Untitled",
        url: `/dashboard/workspace/${scope.workspaceId}/project/${row.projectId}/pages/${row.id}`,
        source: ref,
        author: null,
        // Pages are notes from some point in time; the date lets the
        // answer weigh them against live task data.
        text: `Page: ${row.title || "Untitled"}\nLast updated: ${day(row.updatedAt)}\n${truncateText(row.text ?? "", 4000)}`,
        dataTier: projectDataTier(scope, row.projectId),
        ref,
        updatedAt: row.updatedAt,
      },
    ];
  });
}

async function loadComments(scope: AiScope, ids: string[]): Promise<AskItem[]> {
  const projectIds = [...scope.projectIds];
  if (ids.length === 0 || projectIds.length === 0 || !scope.can.readTasks) {
    return [];
  }
  const rows = await db
    .select({
      id: activityTable.id,
      content: activityTable.content,
      createdAt: activityTable.createdAt,
      author: userTable.name,
      external: activityTable.externalUserName,
      taskId: taskTable.id,
      taskTitle: taskTable.title,
      projectId: taskTable.projectId,
      slug: projectTable.slug,
      number: taskTable.number,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(userTable, eq(userTable.id, activityTable.userId))
    .where(
      and(
        inArray(activityTable.id, ids),
        eq(activityTable.type, "comment"),
        inArray(taskTable.projectId, projectIds),
        eq(projectTable.workspaceId, scope.workspaceId),
        visibleTaskCondition,
      ),
    );
  const order = new Map(ids.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return rows.flatMap((row) => {
    if (!row.content) return [];
    const key = taskKey(row.slug, row.number);
    const ref = `C:${key}/${row.id.slice(0, 6)}`;
    return [
      {
        kind: "comment" as const,
        id: row.id,
        projectId: row.projectId,
        title: `${key} ${row.taskTitle}`,
        url: taskUrl(scope.workspaceId, row.projectId, row.taskId),
        source: ref,
        author: row.author ?? row.external ?? null,
        text: `Comment on ${key} ${row.taskTitle} (${day(row.createdAt)}):\n${truncateText(row.content, 1500)}`,
        dataTier: projectDataTier(scope, row.projectId),
        ref,
        updatedAt: row.createdAt,
      },
    ];
  });
}

function percent(value: number | null): string {
  return value === null ? "unknown" : `${Math.round(value * 100)}%`;
}

/** Computed delivery facts for a cycle (forecast and risks); never cited. */
async function deliveryFacts(
  scope: AiScope,
  cycle: { id: string; name: string; projectId: string },
  keyOf: (taskId: string) => string | null,
): Promise<AskItem | null> {
  try {
    const [forecast, risks] = await Promise.all([
      getForecast("cycle", cycle.id),
      getScopeRisks("cycle", cycle.id, scope.userId),
    ]);
    const known = new Map(
      risks.tasks.map((task) => [
        task.id,
        taskKey(task.projectSlug, task.number),
      ]),
    );
    const lines = [
      `Computed by Margaya for cycle "${cycle.name}" (ends ${forecast.scope.endDate ?? "no end date"}):`,
      `Open tasks remaining: ${forecast.remaining}.`,
      forecast.status === "ok"
        ? `Forecast finish: 50% by ${forecast.p50?.date ?? "beyond horizon"}, 85% by ${forecast.p85?.date ?? "beyond horizon"}, 95% by ${forecast.p95?.date ?? "beyond horizon"}; chance to finish by the end date: ${percent(forecast.probabilityByEnd)}.`
        : forecast.status === "complete"
          ? "Forecast: all work is done."
          : "Forecast: not enough completed work yet to forecast.",
      ...risks.signals.slice(0, 6).map((signal) => {
        const keys = signal.taskIds
          .map((id) => known.get(id) ?? keyOf(id))
          .filter(Boolean)
          .slice(0, 6);
        return `Risk ${signal.kind} (${signal.severity}): ${signal.total} task(s)${keys.length ? ` incl. ${keys.join(", ")}` : ""}.`;
      }),
    ];
    return {
      kind: "project",
      id: cycle.id,
      projectId: cycle.projectId,
      title: cycle.name,
      url: "",
      source: `facts:cycle ${refText(cycle.name)}`,
      author: null,
      text: lines.join("\n"),
      dataTier: projectDataTier(scope, cycle.projectId),
      ref: null,
      updatedAt: null,
    };
  } catch {
    // Forecasts are a bonus; the answer still works without them.
    return null;
  }
}

/**
 * Everything Ask may answer from, most relevant first: live counts for a
 * counting or charting question, tasks the question names, the structured
 * task query, their blockers, then full-text hits over tasks and comments.
 * When live task data exists, pages come last: they are notes from some
 * point in time and may be outdated. Cross-checked with filterToScope.
 */
export async function retrieveAskContext(input: Retrieval): Promise<AskItem[]> {
  const { scope, plan } = input;
  const today = input.now.toISOString().slice(0, 10);
  const [projects, members] = await Promise.all([
    scopeProjects(scope),
    scope.can.readTasks
      ? workspaceMembers(scope.workspaceId)
      : Promise.resolve([]),
  ]);
  const ownProject = input.projectId
    ? null
    : matchProject(projects, input.question, plan.project);
  const ownMembers = matchMembers(members, input.question);
  // A follow-up that names nothing itself ("and its description?") is
  // about the previous turn: the tasks its answer cited, else the project
  // and people its question named.
  const earlier =
    plan.earlier &&
    !ownProject &&
    ownMembers.length === 0 &&
    !plan.cycle &&
    plan.taskKeys.length === 0
      ? plan.earlier
      : null;
  const carriedKeys = earlier?.taskKeys ?? [];
  const leanOnEarlier = earlier !== null && carriedKeys.length === 0;
  const named = input.projectId
    ? (projects.find((project) => project.id === input.projectId) ?? null)
    : (ownProject ??
      (leanOnEarlier && earlier
        ? matchProject(projects, earlier.question, null)
        : null));
  const assignees =
    ownMembers.length > 0
      ? ownMembers
      : leanOnEarlier && earlier
        ? matchMembers(members, earlier.question)
        : [];
  const projectIds = input.projectId
    ? [input.projectId]
    : named
      ? [named.id]
      : projects.map((project) => project.id);
  const taskKeys = [...new Set([...plan.taskKeys, ...carriedKeys])].slice(0, 5);

  // A named project with nothing else to search for reads as "what's
  // going on there": its recently changed open work. Project and member
  // names are filters, not search words.
  const skipWords = [
    ...(ownProject ? nameWords([ownProject.name]) : []),
    ...nameWords(ownMembers.map((member) => member.name)),
  ];
  const terms = plan.terms.filter(
    (term) =>
      !skipWords.includes(term.toLowerCase()) &&
      term.toLowerCase() !== plan.cycle?.toLowerCase(),
  );
  const intents = new Set(plan.intents);
  if (
    named &&
    !input.projectId &&
    terms.length === 0 &&
    intents.size === 0 &&
    assignees.length === 0
  ) {
    intents.add("recent");
    intents.add("open");
  }

  const cycleProjects = projects
    .filter(
      (project) => project.cyclesEnabled && projectIds.includes(project.id),
    )
    .map((project) => project.id);
  const cycle = plan.cycle
    ? matchCycle(await scopeCycles(cycleProjects), plan.cycle)
    : null;

  const structuredQuery = structuredFilters(
    { ...plan, intents },
    {
      cycleId: cycle?.id ?? null,
      assigneeIds: assignees.map((member) => member.id),
      keyed: taskKeys.length > 0,
    },
  );
  const structuredProjects = cycle ? [cycle.projectId] : projectIds;
  // Counting and charting questions get live aggregates for the scope.
  const stats = intents.has("stats") && scope.can.readTasks;
  const factsPromise = stats
    ? workspaceTimeZone(scope.workspaceId).then((timeZone) =>
        loadAskFacts({
          scope,
          projects: projects.filter((project) =>
            projectIds.includes(project.id),
          ),
          now: input.now,
          timeZone,
        }),
      )
    : Promise.resolve(null);
  // Trend questions get created/completed series (and a cycle's burn-up).
  const trendPromise =
    intents.has("trend") && scope.can.readTasks
      ? workspaceTimeZone(scope.workspaceId).then(async (timeZone) => {
          const unit = trendUnitOf(input.question);
          const scoped = cycle ? [cycle.projectId] : projectIds;
          const [buckets, burn] = await Promise.all([
            loadTrend({
              scope,
              projectIds: scoped,
              now: input.now,
              timeZone,
              unit,
            }),
            cycle
              ? loadCycleBurn({ scope, cycle, now: input.now, timeZone })
              : Promise.resolve(null),
          ]);
          const names = projects
            .filter((project) => scoped.includes(project.id))
            .map((project) => project.name);
          const text = formatTrend({
            unit,
            scopeLabel:
              names.length === 1
                ? `project "${names[0]}"`
                : `${names.length} projects`,
            timeZone,
            buckets,
            burn,
          });
          return text ? trendItem(scope, scoped, text) : null;
        })
      : Promise.resolve(null);
  const searchTypes: WorkspaceSearchType[] = [
    ...(scope.can.readTasks ? (["task", "comment"] as const) : []),
    ...(scope.can.readPages ? (["page"] as const) : []),
  ];
  const query = searchQueryOf(terms);

  const [found, hits, keyed, facts, trend] = await Promise.all([
    structuredQuery
      ? structuredTaskIds(input, structuredProjects, structuredQuery)
      : Promise.resolve([]),
    query && searchTypes.length > 0
      ? // Full-text plus semantic neighbours when the workspace has them (D1).
        hybridSearchWorkspace({
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          query,
          semanticQuery: input.question,
          types: searchTypes,
          limit: MAX_SEARCH_HITS,
          projectId: input.projectId ?? undefined,
        })
      : Promise.resolve([]),
    Promise.all(
      taskKeys.map((key) =>
        scope.can.readTasks
          ? searchWorkspace({
              userId: scope.userId,
              workspaceId: scope.workspaceId,
              query: key,
              types: ["task"],
              limit: 1,
              projectId: input.projectId ?? undefined,
            })
          : Promise.resolve([]),
      ),
    ).then((lists) =>
      lists
        .flat()
        .filter((hit) => hit.score >= 10)
        .map((hit) => hit.id),
    ),
    factsPromise,
    trendPromise,
  ]);
  // Open work was assumed ("what's assigned to me?", "Mia's tasks"), and
  // none is open: the same filter over every status shows what is done.
  const matched =
    found.length === 0 && structuredQuery?.openByDefault
      ? await structuredTaskIds(
          input,
          structuredProjects,
          withoutDefaultGroup(structuredQuery),
        )
      : found;
  // Nothing matched a vague question ("what's in this project?") or a small
  // local model's guessed filters: start from the scope's recently changed
  // open work. A specific question that matched nothing ("quantum flux
  // capacitor") and a filter the rules recognised ("my open tasks") stay an
  // honest empty answer. The facts block answers a counting question.
  const vague =
    searchTermsOf(input.question).filter((term) => !skipWords.includes(term))
      .length === 0;
  const structured =
    !facts &&
    !trend &&
    matched.length === 0 &&
    hits.length === 0 &&
    keyed.length === 0 &&
    ((!structuredQuery && vague) ||
      (structuredQuery !== null && plan.intentsGuessed))
      ? await structuredTaskIds(input, projectIds, {
          conditions: [
            { key: "group", operator: "in", values: [...OPEN_COLUMN_GROUPS] },
          ],
          orderBy: "updatedAt",
        })
      : matched;

  const searchTaskIds = hits
    .filter((hit) => hit.type === "task")
    .map((hit) => hit.id);
  // A matching comment brings its task, so the answer can cite both.
  const commentTaskIds = hits.flatMap((hit) =>
    hit.type === "comment" && hit.taskId ? [hit.taskId] : [],
  );
  const focus = [...new Set([...keyed, ...structured])];
  const edges =
    intents.has("blocking") || keyed.length > 0
      ? await blockEdges(focus.length > 0 ? focus : searchTaskIds.slice(0, 10))
      : [];
  const taskIds = [
    ...new Set([
      ...focus,
      ...edges.flatMap((edge) => [edge.from, edge.to]),
      ...searchTaskIds,
      ...commentTaskIds,
    ]),
  ];
  const [tasks, pages, comments] = await Promise.all([
    loadTasks(scope, taskIds),
    loadPages(
      scope,
      hits.filter((hit) => hit.type === "page").map((hit) => hit.id),
    ),
    loadComments(
      scope,
      hits.filter((hit) => hit.type === "comment").map((hit) => hit.id),
    ),
  ]);

  // Relations only name tasks that loaded (visible and AI-readable).
  const blockedBy = new Map<string, TaskRow[]>();
  const blocks = new Map<string, TaskRow[]>();
  for (const edge of edges) {
    const from = tasks.get(edge.from);
    const to = tasks.get(edge.to);
    if (!from || !to || !isOpen(from.group)) continue;
    blockedBy.set(to.id, [...(blockedBy.get(to.id) ?? []), from]);
    blocks.set(from.id, [...(blocks.get(from.id) ?? []), to]);
  }

  const items: AskItem[] = [];
  const seen = new Set<string>();
  const push = (item: AskItem | null) => {
    if (!item) return;
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  const pushTask = (id: string, describe: boolean) => {
    const task = tasks.get(id);
    if (!task) return;
    push(
      taskItem(
        scope,
        task,
        today,
        { blockedBy: blockedBy.get(id) ?? [], blocks: blocks.get(id) ?? [] },
        { describe },
      ),
    );
  };

  if (facts) push(factsItem(scope, facts, projectIds));
  push(trend);
  for (const id of keyed) pushTask(id, true);
  if (cycle && intents.has("risk") && input.canReadAnalytics) {
    push(await deliveryFacts(scope, cycle, (id) => tasks.get(id)?.key ?? null));
  }
  // With "blocking", blocked tasks and their blockers lead.
  const ordered = intents.has("blocking")
    ? [
        ...structured.filter((id) => blockedBy.has(id)),
        ...structured.flatMap((id) =>
          (blockedBy.get(id) ?? []).map((task) => task.id),
        ),
        ...structured,
      ]
    : structured;
  for (const id of ordered) pushTask(id, false);
  for (const edge of edges) {
    if (blockedBy.has(edge.to)) pushTask(edge.from, false);
  }
  // Live task data outranks pages: an agent-written "status table" page
  // can name tasks that changed or were deleted since.
  const liveFirst =
    facts !== null ||
    trend !== null ||
    keyed.length > 0 ||
    structured.length > 0;
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  for (const hit of hits) {
    if (hit.type === "task") pushTask(hit.id, true);
    else if (hit.type === "comment") push(commentById.get(hit.id) ?? null);
    else if (!liveFirst) push(pageById.get(hit.id) ?? null);
  }
  for (const id of commentTaskIds) pushTask(id, false);
  if (liveFirst) {
    for (const hit of hits) {
      if (hit.type === "page") push(pageById.get(hit.id) ?? null);
    }
  }

  return filterToScope(scope, items).slice(0, MAX_ASK_ITEMS);
}

/** What the UI may link to: every citable item, in context order. */
export function sourcesOf(items: readonly AskItem[]): AskSource[] {
  return items.flatMap((item) =>
    item.ref &&
    (item.kind === "task" ||
      item.kind === "page" ||
      item.kind === "comment" ||
      item.kind === "web")
      ? [
          {
            ref: item.ref,
            kind: item.kind,
            id: item.id,
            title: item.title,
            url: item.url,
            projectId: item.projectId,
            updatedAt: item.updatedAt ? item.updatedAt.toISOString() : null,
          },
        ]
      : [],
  );
}

const CITATION_RULE = /\[([TPCW]):([^\]\n]{1,100})\]/g;

/** The refs an answer cites that match a source, in order of first use. */
export function citedRefs(
  text: string,
  sources: readonly AskSource[],
): string[] {
  const known = new Set(sources.map((source) => source.ref));
  const out: string[] = [];
  for (const match of text.matchAll(CITATION_RULE)) {
    const ref = `${match[1]}:${(match[2] ?? "").trim()}`;
    if (known.has(ref) && !out.includes(ref)) out.push(ref);
  }
  return out;
}
