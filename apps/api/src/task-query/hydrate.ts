import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ColumnGroup } from "../column/groups";
import { deriveCycleStatus } from "../cycle/dates";
import {
  columnTable,
  customFieldDefinitionTable,
  customFieldValueTable,
  cycleTable,
  cycleTaskTable,
  estimatePointTable,
  estimateTable,
  externalLinkTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  taskRelationTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import type { EstimateType } from "../estimate/types";
import type { ModuleStatus } from "../module/types";
import { assigneeIdsOfTasks } from "../task/assignees";
import type { TaskReadDatabase } from "../task/bounded-read";
import { taskColumnJoin, taskGroupSql } from "../task/scope";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { type QueryContext, textArray } from "./context";
import type {
  CycleGroupMeta,
  GroupLookup,
  ModuleGroupMeta,
  PointGroupMeta,
} from "./group";
import { subTaskCountSql } from "./order";
import type { TaskQueryInclude } from "./schema";

// Batch hydration of the selected rows and the meta lookups: a fixed number
// of statements whatever the page size (every id list is one array
// parameter), and only what the rows or group keys reference.

export type TaskQueryExternalLink = {
  id: string;
  taskId: string;
  integrationId: string;
  resourceType: string;
  externalId: string;
  url: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskQueryRow = {
  id: string;
  projectId: string;
  number: number | null;
  key: string;
  title: string;
  status: string;
  columnId: string | null;
  group: ColumnGroup;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdBy: string | null;
  userId: string | null;
  position: number | null;
  assigneeIds?: string[];
  labels?: { name: string; color: string }[];
  cycleId?: string | null;
  moduleIds?: string[];
  estimatePointId?: string | null;
  parentId?: string | null;
  subTaskCount?: number;
  customFieldValues?: { fieldId: string; value: string }[];
  externalLinks?: TaskQueryExternalLink[];
};

const hydrateMembership = alias(cycleTaskTable, "hydrate_cycle_task");
const hydrateCycle = alias(cycleTable, "hydrate_cycle");
const hydrateParent = alias(taskRelationTable, "hydrate_parent");
const workspaceLabel = alias(labelTable, "hydrate_workspace_label");

const cycleIdSql = sql<string | null>`(
  select ${hydrateMembership.cycleId}
  from ${cycleTaskTable} as ${sql.identifier("hydrate_cycle_task")}
  inner join ${cycleTable} as ${sql.identifier("hydrate_cycle")}
    on ${hydrateCycle.id} = ${hydrateMembership.cycleId}
    and ${hydrateCycle.projectId} = ${taskTable.projectId}
  where ${hydrateMembership.taskId} = ${taskTable.id}
)`;

// The oldest subtask relation names the parent (K17); a trashed parent
// reads as none (C7).
const parentIdSql = sql<string | null>`(
  select ${hydrateParent.sourceTaskId}
  from ${taskRelationTable} as ${sql.identifier("hydrate_parent")}
  where ${hydrateParent.targetTaskId} = ${taskTable.id}
    and ${hydrateParent.relationType} = 'subtask'
    and not exists (
      select 1 from ${taskTable} as ${sql.identifier("hydrate_parent_task")}
      where ${sql.identifier("hydrate_parent_task")}.${sql.identifier("id")} = ${hydrateParent.sourceTaskId}
        and ${sql.identifier("hydrate_parent_task")}.${sql.identifier("deleted_at")} is not null
    )
  order by ${hydrateParent.createdAt} asc, ${hydrateParent.id} asc
  limit 1
)`;

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function listByTask<T>(rows: Array<{ taskId: string | null } & T>) {
  const byTask = new Map<string, T[]>();
  for (const { taskId, ...row } of rows) {
    if (!taskId) continue;
    const list = byTask.get(taskId) ?? [];
    list.push(row as unknown as T);
    byTask.set(taskId, list);
  }
  return byTask;
}

/** The rows of these tasks, keyed by id, with the requested extras. */
export async function hydrateRows(
  tx: TaskReadDatabase,
  context: QueryContext,
  ids: readonly string[],
  include: ReadonlySet<TaskQueryInclude>,
): Promise<Map<string, TaskQueryRow>> {
  const rows = new Map<string, TaskQueryRow>();
  if (ids.length === 0) return rows;
  const idList = textArray(ids);

  const base = await tx
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      title: taskTable.title,
      status: taskTable.status,
      columnId: taskTable.columnId,
      group: taskGroupSql,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      createdAt: taskTable.createdAt,
      updatedAt: taskTable.updatedAt,
      completedAt: taskTable.completedAt,
      archivedAt: taskTable.archivedAt,
      createdBy: taskTable.createdBy,
      userId: taskTable.userId,
      position: taskTable.position,
      estimatePointId: taskTable.estimatePointId,
      cycleId: include.has("cycle") ? cycleIdSql : sql<null>`null`,
      parentId: include.has("subTasks") ? parentIdSql : sql<null>`null`,
      subTaskCount: include.has("subTasks") ? subTaskCountSql : sql<null>`null`,
    })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(sql`${taskTable.id} = any(${idList})`);

  for (const row of base) {
    const project = context.projectById.get(row.projectId);
    const { estimatePointId, cycleId, parentId, subTaskCount, ...fields } = row;
    const task: TaskQueryRow = {
      ...fields,
      group: (row.group ?? "unstarted") as ColumnGroup,
      key: formatTaskKey(project?.slug ?? "", row.number),
    };
    // A feature that is off reads as "no value" (K6).
    if (include.has("cycle")) {
      task.cycleId = project?.cyclesEnabled ? (cycleId ?? null) : null;
    }
    if (include.has("estimate")) {
      task.estimatePointId = project?.estimatesEnabled ? estimatePointId : null;
    }
    if (include.has("subTasks")) {
      task.parentId = parentId ?? null;
      task.subTaskCount = Number(subTaskCount ?? 0);
    }
    rows.set(task.id, task);
  }

  if (include.has("assignees")) {
    const assignees = await assigneeIdsOfTasks([...rows.keys()], tx);
    for (const task of rows.values()) {
      task.assigneeIds = assignees.get(task.id) ?? [];
    }
  }

  if (include.has("labels")) {
    // Deduplicated by name (copies are unique per task and name); the
    // workspace label's color wins over the copy's.
    const labels = await tx
      .select({
        taskId: labelTable.taskId,
        name: labelTable.name,
        color: sql<string>`coalesce(${workspaceLabel.color}, ${labelTable.color})`,
      })
      .from(labelTable)
      .leftJoin(
        workspaceLabel,
        and(
          eq(workspaceLabel.workspaceId, context.workspaceId),
          isNull(workspaceLabel.taskId),
          eq(workspaceLabel.name, labelTable.name),
        ),
      )
      .where(sql`${labelTable.taskId} = any(${idList})`)
      .orderBy(asc(sql`lower(${labelTable.name})`), asc(labelTable.name));
    const byTask = listByTask<{ name: string; color: string }>(labels);
    for (const task of rows.values()) task.labels = byTask.get(task.id) ?? [];
  }

  if (include.has("modules")) {
    const links = await tx
      .select({ taskId: moduleTaskTable.taskId, moduleId: moduleTable.id })
      .from(moduleTaskTable)
      .innerJoin(taskTable, eq(taskTable.id, moduleTaskTable.taskId))
      .innerJoin(
        moduleTable,
        and(
          eq(moduleTable.id, moduleTaskTable.moduleId),
          eq(moduleTable.projectId, taskTable.projectId),
          isNull(moduleTable.archivedAt),
        ),
      )
      .where(sql`${moduleTaskTable.taskId} = any(${idList})`)
      .orderBy(asc(sql`lower(${moduleTable.name})`), asc(moduleTable.id));
    const byTask = listByTask<{ moduleId: string }>(links);
    for (const task of rows.values()) {
      const enabled = context.projectById.get(task.projectId)?.modulesEnabled;
      task.moduleIds = enabled
        ? (byTask.get(task.id) ?? []).map((link) => link.moduleId)
        : [];
    }
  }

  if (include.has("customFields")) {
    const values = await tx
      .select({
        taskId: customFieldValueTable.taskId,
        fieldId: customFieldValueTable.fieldId,
        value: sql<string>`${customFieldValueTable.value}`,
      })
      .from(customFieldValueTable)
      .innerJoin(taskTable, eq(taskTable.id, customFieldValueTable.taskId))
      .innerJoin(
        customFieldDefinitionTable,
        and(
          eq(customFieldDefinitionTable.id, customFieldValueTable.fieldId),
          eq(customFieldDefinitionTable.projectId, taskTable.projectId),
        ),
      )
      .where(
        and(
          sql`${customFieldValueTable.taskId} = any(${idList})`,
          isNotNull(customFieldValueTable.value),
        ),
      )
      .orderBy(
        asc(customFieldDefinitionTable.position),
        asc(customFieldDefinitionTable.id),
      );
    const byTask = listByTask<{ fieldId: string; value: string }>(values);
    for (const task of rows.values()) {
      task.customFieldValues = byTask.get(task.id) ?? [];
    }
  }

  if (include.has("externalLinks")) {
    const links = await tx
      .select()
      .from(externalLinkTable)
      .where(sql`${externalLinkTable.taskId} = any(${idList})`)
      .orderBy(asc(externalLinkTable.createdAt), asc(externalLinkTable.id));
    const byTask = new Map<string, TaskQueryExternalLink[]>();
    for (const link of links) {
      const list = byTask.get(link.taskId) ?? [];
      list.push({ ...link, metadata: parseMetadata(link.metadata) });
      byTask.set(link.taskId, list);
    }
    for (const task of rows.values()) {
      task.externalLinks = byTask.get(task.id) ?? [];
    }
  }

  return rows;
}

// --- meta ------------------------------------------------------------------

export type UserMeta = { id: string; name: string; image: string | null };

export type LabelMeta = {
  key: string;
  name: string;
  color: string;
  workspaceLabelId: string | null;
};

export type EstimatePointMeta = {
  id: string;
  projectId: string;
  value: string;
  position: number;
  type: EstimateType;
};

export type CustomFieldMeta = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  options: unknown;
};

function missing(loaded: ReadonlySet<string>, ids: Iterable<string>) {
  return [...new Set(ids)].filter((id) => id && !loaded.has(id));
}

/**
 * Meta lookups loaded at most once per id, so group ordering (before the
 * page) and rendering (after it) share one read per kind in the usual case.
 */
export class MetaStore implements GroupLookup {
  readonly users = new Map<string, UserMeta>();
  readonly cycles = new Map<string, CycleGroupMeta>();
  readonly modules = new Map<string, ModuleGroupMeta>();
  readonly points = new Map<string, PointGroupMeta & EstimatePointMeta>();
  readonly labels = new Map<string, LabelMeta>();
  private readonly loaded = {
    users: new Set<string>(),
    cycles: new Set<string>(),
    modules: new Set<string>(),
    points: new Set<string>(),
    labels: new Set<string>(),
  };

  constructor(
    private readonly tx: TaskReadDatabase,
    readonly context: QueryContext,
  ) {}

  /** Workspace members only; never emails. */
  async loadUsers(ids: Iterable<string>): Promise<void> {
    const wanted = missing(this.loaded.users, ids);
    if (wanted.length === 0 || this.context.publicContext) return;
    for (const id of wanted) this.loaded.users.add(id);
    const rows = await this.tx
      .select({
        id: userTable.id,
        name: userTable.name,
        image: userTable.image,
      })
      .from(userTable)
      .innerJoin(
        workspaceUserTable,
        and(
          eq(workspaceUserTable.userId, userTable.id),
          eq(workspaceUserTable.workspaceId, this.context.workspaceId),
        ),
      )
      .where(sql`${userTable.id} = any(${textArray(wanted)})`);
    for (const row of rows) this.users.set(row.id, row);
  }

  addUsers(users: Iterable<UserMeta>): void {
    for (const user of users) {
      this.loaded.users.add(user.id);
      this.users.set(user.id, user);
    }
  }

  async loadCycles(ids: Iterable<string>): Promise<void> {
    const wanted = missing(this.loaded.cycles, ids);
    if (wanted.length === 0) return;
    for (const id of wanted) this.loaded.cycles.add(id);
    this.addCycles(
      await this.tx
        .select(cycleColumns)
        .from(cycleTable)
        .where(
          and(
            sql`${cycleTable.id} = any(${textArray(wanted)})`,
            sql`${cycleTable.projectId} = any(${textArray(this.context.projectIds)})`,
          ),
        ),
    );
  }

  addCycles(rows: CycleRow[]): void {
    for (const row of rows) {
      this.loaded.cycles.add(row.id);
      this.cycles.set(row.id, {
        ...row,
        status: deriveCycleStatus(row, this.context.utcToday),
      });
    }
  }

  async loadModules(ids: Iterable<string>): Promise<void> {
    const wanted = missing(this.loaded.modules, ids);
    if (wanted.length === 0) return;
    for (const id of wanted) this.loaded.modules.add(id);
    this.addModules(
      await this.tx
        .select(moduleColumns)
        .from(moduleTable)
        .where(
          and(
            sql`${moduleTable.id} = any(${textArray(wanted)})`,
            sql`${moduleTable.projectId} = any(${textArray(this.context.projectIds)})`,
          ),
        ),
    );
  }

  addModules(rows: ModuleGroupMeta[]): void {
    for (const row of rows) {
      this.loaded.modules.add(row.id);
      this.modules.set(row.id, row);
    }
  }

  async loadPoints(ids: Iterable<string>): Promise<void> {
    const wanted = missing(this.loaded.points, ids);
    if (wanted.length === 0) return;
    for (const id of wanted) this.loaded.points.add(id);
    this.addPoints(
      await this.tx
        .select(pointColumns)
        .from(estimatePointTable)
        .innerJoin(
          estimateTable,
          eq(estimateTable.id, estimatePointTable.estimateId),
        )
        .where(
          and(
            sql`${estimatePointTable.id} = any(${textArray(wanted)})`,
            sql`${estimateTable.projectId} = any(${textArray(this.context.projectIds)})`,
          ),
        ),
    );
  }

  addPoints(rows: EstimatePointMeta[]): void {
    for (const row of rows) {
      this.loaded.points.add(row.id);
      this.points.set(row.id, row);
    }
  }

  /**
   * Label group headers by name: the workspace label's id and color when
   * one has the name, else the oldest copy's color.
   */
  async loadLabels(keys: Iterable<string>, prefix: string): Promise<void> {
    const wanted = missing(this.loaded.labels, keys).filter((key) =>
      key.startsWith(prefix),
    );
    if (wanted.length === 0) return;
    for (const key of wanted) this.loaded.labels.add(key);
    const names = wanted.map((key) => key.slice(prefix.length));
    const rows = await this.tx
      .selectDistinctOn([labelTable.name], {
        id: labelTable.id,
        name: labelTable.name,
        color: labelTable.color,
        taskId: labelTable.taskId,
      })
      .from(labelTable)
      .where(
        and(
          eq(labelTable.workspaceId, this.context.workspaceId),
          sql`${labelTable.name} = any(${textArray(names)})`,
        ),
      )
      .orderBy(
        asc(labelTable.name),
        sql`(${labelTable.taskId} is null) desc`,
        asc(labelTable.createdAt),
        asc(labelTable.id),
      );
    for (const row of rows) {
      const key = `${prefix}${row.name}`;
      this.labels.set(key, {
        key,
        name: row.name,
        color: row.color,
        workspaceLabelId: row.taskId === null ? row.id : null,
      });
    }
  }

  async loadCustomFields(projectIds: Iterable<string>) {
    const ids = [...new Set(projectIds)];
    if (ids.length === 0) return [] as CustomFieldMeta[];
    return this.tx
      .select({
        id: customFieldDefinitionTable.id,
        projectId: customFieldDefinitionTable.projectId,
        name: customFieldDefinitionTable.name,
        type: customFieldDefinitionTable.type,
        options: customFieldDefinitionTable.options,
      })
      .from(customFieldDefinitionTable)
      .where(
        sql`${customFieldDefinitionTable.projectId} = any(${textArray(ids)})`,
      )
      .orderBy(
        asc(customFieldDefinitionTable.projectId),
        asc(customFieldDefinitionTable.position),
        asc(customFieldDefinitionTable.id),
      ) as Promise<CustomFieldMeta[]>;
  }
}

export const cycleColumns = {
  id: cycleTable.id,
  projectId: cycleTable.projectId,
  name: cycleTable.name,
  startDate: cycleTable.startDate,
  endDate: cycleTable.endDate,
  sortOrder: cycleTable.sortOrder,
  createdAt: cycleTable.createdAt,
};

export type CycleRow = {
  id: string;
  projectId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  createdAt: Date;
};

export const moduleColumns = {
  id: moduleTable.id,
  projectId: moduleTable.projectId,
  name: moduleTable.name,
  status: sql<ModuleStatus>`${moduleTable.status}`,
};

export const pointColumns = {
  id: estimatePointTable.id,
  projectId: estimateTable.projectId,
  value: estimatePointTable.value,
  position: estimatePointTable.position,
  type: estimateTable.type,
};
