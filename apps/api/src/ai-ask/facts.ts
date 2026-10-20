import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AiScope } from "../ai/context";
import {
  COLUMN_GROUP_RANK,
  type ColumnGroup,
  isOpenGroup,
  OPEN_COLUMN_GROUPS,
} from "../column/groups";
import db from "../database";
import {
  columnTable,
  cycleTable,
  cycleTaskTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  projectTable,
  taskAssigneeTable,
  taskTable,
  userTable,
} from "../database/schema";
import { BREAKDOWN_PRIORITIES } from "../task/progress";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { addDays } from "../task-query/dates";
import { startOfLocalDayUtc, todayInTimezone } from "../utils/zoned-date";
import type { AskItem } from "./retrieve";

// Live aggregates for counting and charting questions ("how many tasks are
// in each status?"). Every number is a GROUP BY over the tasks the caller
// can see in the Ask scope: archived, trashed and triage tasks are left out
// (visibleTaskCondition), as on the board. The block is never cited.

/** Rows per breakdown; the rest is summarised as "N more". */
export const MAX_FACT_ROWS = 25;

export type FactCount = { label: string; total: number; open: number };

export type AskFacts = {
  /** Project names, in board order. */
  projects: string[];
  today: string;
  timeZone: string;
  total: number;
  open: number;
  completed: number;
  cancelled: number;
  /** Open tasks due before today. */
  overdue: number;
  /** Open tasks due today or in the next 6 days. */
  dueSoon: number;
  /** Tasks in a completed column, completed today or in the 6 days before. */
  completedLast7Days: number;
  /** Only with more than one project. */
  byProject: FactCount[] | null;
  /** Board order; `group` is the column's status group. */
  byStatus: (FactCount & { group: ColumnGroup })[];
  byGroup: { group: ColumnGroup; total: number }[];
  byPriority: FactCount[];
  /** Includes "Unassigned"; a task counts once per assignee. */
  byAssignee: FactCount[];
  /** Includes "No label"; a task counts once per label. */
  byLabel: FactCount[];
  /** Null when no project in scope has cycles on. */
  byCycle: FactCount[] | null;
  /** Null when no project in scope has modules on. */
  byModule: FactCount[] | null;
  /** Breakdowns cut at MAX_FACT_ROWS: how many rows were left out. */
  more: Partial<Record<"assignee" | "label" | "cycle" | "module", number>>;
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  "no-priority": "No priority",
};

function countLine(row: FactCount, withOpen: boolean): string {
  return withOpen && row.open !== row.total
    ? `- ${row.label}: ${row.total} (${row.open} open)`
    : `- ${row.label}: ${row.total}`;
}

function section(
  title: string,
  rows: readonly FactCount[],
  more = 0,
  withOpen = true,
): string[] {
  if (rows.length === 0) return [];
  return [
    `${title}:`,
    ...rows.map((row) => countLine(row, withOpen)),
    ...(more > 0 ? [`- (${more} more not listed)`] : []),
  ];
}

/** The facts as the plain-text block the model reads. */
export function formatAskFacts(facts: AskFacts): string {
  const scope =
    facts.projects.length === 1
      ? `project "${facts.projects[0]}"`
      : `${facts.projects.length} projects (${facts.projects.join(", ")})`;
  const closed = facts.completed + facts.cancelled;
  const lines = [
    `Live counts computed by Margaya for ${scope}, today ${facts.today} (${facts.timeZone}). Archived, trashed and triage tasks are not counted. "open" means backlog, not started or started; "closed" means completed or cancelled.`,
    `Tasks: ${facts.total} total, ${facts.open} open, ${closed} closed (${facts.completed} completed, ${facts.cancelled} cancelled).`,
    `Overdue (open, due before today): ${facts.overdue}. Due in the next 7 days (open): ${facts.dueSoon}.`,
    `Completed in the last 7 days (today and the 6 days before): ${facts.completedLast7Days}.`,
    ...(facts.byProject ? section("By project", facts.byProject) : []),
    ...section(
      "By status column, in board order",
      facts.byStatus.map((row) => ({
        ...row,
        label: `${row.label} (${row.group})`,
      })),
      0,
      false,
    ),
    ...section(
      "By status group",
      facts.byGroup.map((row) => ({
        label: row.group,
        total: row.total,
        open: row.total,
      })),
      0,
      false,
    ),
    ...section("By priority", facts.byPriority),
    ...section(
      "By assignee (a task with several assignees counts for each)",
      facts.byAssignee,
      facts.more.assignee,
    ),
    ...section(
      "By label (a task with several labels counts for each)",
      facts.byLabel,
      facts.more.label,
    ),
    ...(facts.byCycle
      ? section("By cycle", facts.byCycle, facts.more.cycle)
      : []),
    ...(facts.byModule
      ? section(
          "By module (a task in several modules counts for each)",
          facts.byModule,
          facts.more.module,
        )
      : []),
  ];
  return lines.join("\n");
}

type FactProject = {
  id: string;
  name: string;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
};

const openSql = sql`${taskGroupSql} in (${sql.join(
  OPEN_COLUMN_GROUPS.map((group) => sql`${group}`),
  sql`, `,
)})`;

const countSql = sql<number>`count(*)::int`.mapWith(Number);
const openCountSql =
  sql<number>`(count(*) filter (where ${openSql}))::int`.mapWith(Number);
const countWhere = (condition: SQL) =>
  sql<number>`(count(*) filter (where ${condition}))::int`.mapWith(Number);

const noAssigneeSql = sql`not exists (select 1 from ${taskAssigneeTable} where ${taskAssigneeTable.taskId} = ${taskTable.id})`;
const noLabelSql = sql`not exists (select 1 from ${labelTable} where ${labelTable.taskId} = ${taskTable.id} and ${labelTable.deletionStartedAt} is null)`;
const noCycleSql = sql`not exists (select 1 from ${cycleTaskTable} inner join ${cycleTable} on ${cycleTable.id} = ${cycleTaskTable.cycleId} and ${cycleTable.projectId} = ${taskTable.projectId} where ${cycleTaskTable.taskId} = ${taskTable.id})`;
const noModuleSql = sql`not exists (select 1 from ${moduleTaskTable} inner join ${moduleTable} on ${moduleTable.id} = ${moduleTaskTable.moduleId} and ${moduleTable.projectId} = ${taskTable.projectId} and ${moduleTable.archivedAt} is null where ${moduleTaskTable.taskId} = ${taskTable.id})`;

function priorityRank(priority: string): number {
  const index = (BREAKDOWN_PRIORITIES as readonly string[]).indexOf(priority);
  return index < 0 ? BREAKDOWN_PRIORITIES.length : index;
}

function cut<T>(rows: T[]): { rows: T[]; more: number } {
  return rows.length > MAX_FACT_ROWS
    ? { rows: rows.slice(0, MAX_FACT_ROWS), more: rows.length - MAX_FACT_ROWS }
    : { rows, more: 0 };
}

/**
 * Loads the aggregates for these projects (already limited to the AI
 * scope). Breakdowns are bounded: at most MAX_FACT_ROWS + 1 rows each, and
 * the "more" count is a lower bound when a breakdown is cut.
 */
export async function loadAskFacts(input: {
  scope: AiScope;
  projects: readonly FactProject[];
  now: Date;
  timeZone: string;
}): Promise<AskFacts | null> {
  const { scope, now, timeZone } = input;
  const projects = input.projects.filter((project) =>
    scope.projectIds.has(project.id),
  );
  if (projects.length === 0 || !scope.can.readTasks) return null;
  const projectIds = projects.map((project) => project.id);
  const today = todayInTimezone(timeZone, now);
  const startToday = startOfLocalDayUtc(today, timeZone);
  const startInAWeek = startOfLocalDayUtc(addDays(today, 7), timeZone);
  const startAWeekAgo = startOfLocalDayUtc(addDays(today, -6), timeZone);
  const where = and(
    inArray(taskTable.projectId, projectIds),
    eq(projectTable.workspaceId, scope.workspaceId),
    visibleTaskCondition,
  );
  const cycleProjects = projects.filter((project) => project.cyclesEnabled);
  const moduleProjects = projects.filter((project) => project.modulesEnabled);
  const multi = projects.length > 1;
  const limit = MAX_FACT_ROWS + 1;

  const [
    statusRows,
    priorityRows,
    assigneeRows,
    labelRows,
    cycleRows,
    moduleRows,
  ] = await Promise.all([
    db
      .select({
        projectId: taskTable.projectId,
        status: taskTable.status,
        column: columnTable.name,
        position: columnTable.position,
        group: taskGroupSql,
        total: countSql,
        overdue: countWhere(
          sql`${openSql} and ${lt(taskTable.dueDate, startToday)}`,
        ),
        dueSoon: countWhere(
          sql`${openSql} and ${and(gte(taskTable.dueDate, startToday), lt(taskTable.dueDate, startInAWeek))}`,
        ),
        completedRecently: countWhere(
          sql`${taskGroupSql} = 'completed' and ${gte(taskTable.completedAt, startAWeekAgo)}`,
        ),
        unassigned: countWhere(noAssigneeSql),
        noLabel: countWhere(noLabelSql),
        noCycle: countWhere(noCycleSql),
        noModule: countWhere(noModuleSql),
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(where)
      .groupBy(
        taskTable.projectId,
        taskTable.status,
        columnTable.name,
        columnTable.position,
        columnTable.group,
      ),
    db
      .select({
        priority: taskTable.priority,
        total: countSql,
        open: openCountSql,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(where)
      .groupBy(taskTable.priority)
      .limit(20),
    db
      .select({
        name: userTable.name,
        total: countSql,
        open: openCountSql,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .innerJoin(taskAssigneeTable, eq(taskAssigneeTable.taskId, taskTable.id))
      .innerJoin(userTable, eq(userTable.id, taskAssigneeTable.userId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(where)
      .groupBy(userTable.id, userTable.name)
      .orderBy(desc(countSql), userTable.name)
      .limit(limit),
    db
      .select({
        name: labelTable.name,
        total: countSql,
        open: openCountSql,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .innerJoin(
        labelTable,
        and(
          eq(labelTable.taskId, taskTable.id),
          isNull(labelTable.deletionStartedAt),
        ),
      )
      .leftJoin(columnTable, taskColumnJoin)
      .where(where)
      .groupBy(labelTable.name)
      .orderBy(desc(countSql), labelTable.name)
      .limit(limit),
    cycleProjects.length > 0
      ? db
          .select({
            name: cycleTable.name,
            project: projectTable.name,
            archived: sql<boolean>`${cycleTable.archivedAt} is not null`,
            total: countSql,
            open: openCountSql,
          })
          .from(taskTable)
          .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
          .innerJoin(cycleTaskTable, eq(cycleTaskTable.taskId, taskTable.id))
          .innerJoin(
            cycleTable,
            and(
              eq(cycleTable.id, cycleTaskTable.cycleId),
              eq(cycleTable.projectId, taskTable.projectId),
            ),
          )
          .leftJoin(columnTable, taskColumnJoin)
          .where(
            and(
              where,
              inArray(
                taskTable.projectId,
                cycleProjects.map((project) => project.id),
              ),
            ),
          )
          .groupBy(cycleTable.id, cycleTable.name, projectTable.name)
          .orderBy(desc(countSql), cycleTable.name)
          .limit(limit)
      : Promise.resolve(null),
    moduleProjects.length > 0
      ? db
          .select({
            name: moduleTable.name,
            project: projectTable.name,
            total: countSql,
            open: openCountSql,
          })
          .from(taskTable)
          .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
          .innerJoin(moduleTaskTable, eq(moduleTaskTable.taskId, taskTable.id))
          .innerJoin(
            moduleTable,
            and(
              eq(moduleTable.id, moduleTaskTable.moduleId),
              eq(moduleTable.projectId, taskTable.projectId),
              isNull(moduleTable.archivedAt),
            ),
          )
          .leftJoin(columnTable, taskColumnJoin)
          .where(
            and(
              where,
              inArray(
                taskTable.projectId,
                moduleProjects.map((project) => project.id),
              ),
            ),
          )
          .groupBy(moduleTable.id, moduleTable.name, projectTable.name)
          .orderBy(desc(countSql), moduleTable.name)
          .limit(limit)
      : Promise.resolve(null),
  ]);

  const named = (name: string, project: string) =>
    multi ? `${name} (${project})` : name;
  const cycleOn = new Set(cycleProjects.map((project) => project.id));
  const moduleOn = new Set(moduleProjects.map((project) => project.id));
  const projectOrder = new Map(
    projects.map((project, index) => [project.id, index]),
  );

  let total = 0;
  let open = 0;
  let completed = 0;
  let cancelled = 0;
  let overdue = 0;
  let dueSoon = 0;
  let completedLast7Days = 0;
  const unassigned = { label: "Unassigned", total: 0, open: 0 };
  const noLabel = { label: "No label", total: 0, open: 0 };
  const noCycle = { label: "No cycle", total: 0, open: 0 };
  const noModule = { label: "No module", total: 0, open: 0 };
  const perProject = new Map<string, FactCount>();
  const groups = new Map<ColumnGroup, number>();
  // Columns merge by name across projects, in board order.
  const statuses = new Map<
    string,
    FactCount & { group: ColumnGroup; rank: [number, number, number] }
  >();
  const sorted = [...statusRows].sort(
    (a, b) =>
      (projectOrder.get(a.projectId) ?? 0) -
        (projectOrder.get(b.projectId) ?? 0) ||
      (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER),
  );
  for (const row of sorted) {
    const isOpen = isOpenGroup(row.group);
    const openCount = isOpen ? row.total : 0;
    total += row.total;
    open += openCount;
    if (row.group === "completed") completed += row.total;
    if (row.group === "cancelled") cancelled += row.total;
    overdue += row.overdue;
    dueSoon += row.dueSoon;
    completedLast7Days += row.completedRecently;
    unassigned.total += row.unassigned;
    if (isOpen) unassigned.open += row.unassigned;
    noLabel.total += row.noLabel;
    if (isOpen) noLabel.open += row.noLabel;
    if (cycleOn.has(row.projectId)) {
      noCycle.total += row.noCycle;
      if (isOpen) noCycle.open += row.noCycle;
    }
    if (moduleOn.has(row.projectId)) {
      noModule.total += row.noModule;
      if (isOpen) noModule.open += row.noModule;
    }
    groups.set(row.group, (groups.get(row.group) ?? 0) + row.total);

    const project = projects.find((entry) => entry.id === row.projectId);
    if (project) {
      const entry = perProject.get(project.id) ?? {
        label: project.name,
        total: 0,
        open: 0,
      };
      entry.total += row.total;
      entry.open += openCount;
      perProject.set(project.id, entry);
    }

    const label = row.column ?? row.status;
    const key = `${label.toLowerCase()}\u0000${row.group}`;
    const status = statuses.get(key) ?? {
      label,
      group: row.group,
      total: 0,
      open: 0,
      rank: [
        row.position ?? Number.MAX_SAFE_INTEGER,
        COLUMN_GROUP_RANK[row.group] ?? 9,
        statuses.size,
      ],
    };
    status.total += row.total;
    status.open += openCount;
    statuses.set(key, status);
  }

  const byStatus = [...statuses.values()]
    .sort(
      (a, b) =>
        a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2],
    )
    .slice(0, 60)
    .map(({ rank: _rank, ...row }) => row);
  const byGroup = [...groups.entries()]
    .filter(([, count]) => count > 0)
    .sort(
      ([a], [b]) => (COLUMN_GROUP_RANK[a] ?? 9) - (COLUMN_GROUP_RANK[b] ?? 9),
    )
    .map(([group, count]) => ({ group, total: count }));
  const byPriority = [...priorityRows]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .map((row) => ({
      label: PRIORITY_LABELS[row.priority] ?? row.priority,
      total: row.total,
      open: row.open,
    }));

  const assignees = cut(
    assigneeRows.map((row) => ({
      label: row.name,
      total: row.total,
      open: row.open,
    })),
  );
  const labels = cut(
    labelRows.map((row) => ({
      label: row.name,
      total: row.total,
      open: row.open,
    })),
  );
  const cycles = cycleRows
    ? cut(
        cycleRows.map((row) => ({
          label: `${named(row.name, row.project)}${row.archived ? " (archived)" : ""}`,
          total: row.total,
          open: row.open,
        })),
      )
    : null;
  const modules = moduleRows
    ? cut(
        moduleRows.map((row) => ({
          label: named(row.name, row.project),
          total: row.total,
          open: row.open,
        })),
      )
    : null;
  const withNone = (rows: FactCount[], none: FactCount) =>
    none.total > 0 ? [...rows, none] : rows;

  return {
    projects: projects.map((project) => project.name),
    today,
    timeZone,
    total,
    open,
    completed,
    cancelled,
    overdue,
    dueSoon,
    completedLast7Days,
    byProject: multi
      ? cut(
          projects.map(
            (project) =>
              perProject.get(project.id) ?? {
                label: project.name,
                total: 0,
                open: 0,
              },
          ),
        ).rows
      : null,
    byStatus,
    byGroup,
    byPriority,
    byAssignee: withNone(assignees.rows, unassigned),
    byLabel: withNone(labels.rows, noLabel),
    byCycle: cycles ? withNone(cycles.rows, noCycle) : null,
    byModule: modules ? withNone(modules.rows, noModule) : null,
    more: {
      ...(assignees.more ? { assignee: assignees.more } : {}),
      ...(labels.more ? { label: labels.more } : {}),
      ...(cycles?.more ? { cycle: cycles.more } : {}),
      ...(modules?.more ? { module: modules.more } : {}),
    },
  };
}

/** The facts as an Ask context item (kind project, never cited). */
export function factsItem(
  scope: AiScope,
  facts: AskFacts,
  projectIds: readonly string[],
): AskItem {
  const single = projectIds.length === 1 ? (projectIds[0] ?? null) : null;
  const restricted = projectIds.some((id) =>
    scope.restrictedProjectIds.has(id),
  );
  return {
    kind: "project",
    id: single ? `facts:${single}` : "facts:workspace",
    projectId: single,
    title: "Live counts",
    url: "",
    source:
      facts.projects.length === 1
        ? `facts:counts ${facts.projects[0]?.replace(/[[\]\r\n"]+/g, " ").slice(0, 80)}`
        : "facts:counts",
    author: null,
    text: formatAskFacts(facts),
    dataTier: restricted ? "restricted" : "private",
    ref: null,
    updatedAt: null,
  };
}
