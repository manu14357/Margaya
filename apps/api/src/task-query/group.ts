import { type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { COLUMN_GROUP_RANK, type ColumnGroup } from "../column/groups";
import type { CycleStatus } from "../cycle/types";
import {
  cycleTable,
  cycleTaskTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  taskTable,
} from "../database/schema";
import { MODULE_STATUSES, type ModuleStatus } from "../module/types";
import { assigneesOfTaskSql } from "../task/assignees";
import { PLANNED_STATUS, taskGroupSql } from "../task/scope";
import { VALID_PRIORITIES } from "../task/validate-task-fields";
import { featureOn, type QueryContext } from "./context";
import { customFieldValueSql } from "./keys/custom-field";
import { LABEL_NAME_PREFIX } from "./keys/label";
import {
  customFieldIdOfKey,
  type GroupByKey,
  isCustomFieldDisplayKey,
} from "./schema";

// Group keys per task (B4 §3.4). Single-valued keys give one text key;
// many-valued keys (assignee, label, module) give a text array, and a task
// sits in every group of its array. No value is the `none` group; a feature
// that is off for the task's project also reads as `none` (K6).

export const NONE_GROUP = "none";
export const ALL_GROUP = "all";

/** Custom field groups are `value:<value>`, so a value "none" stays a value. */
export const CUSTOM_FIELD_VALUE_PREFIX = "value:";

export type GroupKeyExpression = { many: boolean; sql: SQL };

/** Keys whose groups are users; a public board cannot group by them. */
export const USER_GROUP_KEYS: readonly GroupByKey[] = ["assignee", "createdBy"];

const groupLabel = alias(labelTable, "group_label");
const groupMembership = alias(cycleTaskTable, "group_cycle_task");
const groupCycle = alias(cycleTable, "group_cycle");
const groupLink = alias(moduleTaskTable, "group_module_task");
const groupModule = alias(moduleTable, "group_module");

const EMPTY_KEYS = sql`'{}'::text[]`;

/** The key expression of a group-by key; never NULL. */
export function groupKeyExpression(
  key: GroupByKey,
  context: QueryContext,
): GroupKeyExpression {
  if (isCustomFieldDisplayKey(key)) {
    return {
      many: false,
      sql: sql`coalesce(${sql.raw(`'${CUSTOM_FIELD_VALUE_PREFIX}'`)} || ${customFieldValueSql(customFieldIdOfKey(key))}, ${NONE_GROUP}::text)`,
    };
  }
  switch (key) {
    case "status":
      return { many: false, sql: sql`${taskTable.status}` };
    case "group":
      return { many: false, sql: sql`(${taskGroupSql})` };
    case "priority":
      return { many: false, sql: sql`${taskTable.priority}` };
    case "project":
      return { many: false, sql: sql`${taskTable.projectId}` };
    case "createdBy":
      return {
        many: false,
        sql: sql`coalesce(${taskTable.createdBy}, ${NONE_GROUP}::text)`,
      };
    case "estimate":
      return {
        many: false,
        sql: sql`(case when ${featureOn("estimates", context)} and ${taskTable.estimatePointId} is not null then ${taskTable.estimatePointId} else ${NONE_GROUP}::text end)`,
      };
    case "cycle":
      return {
        many: false,
        sql: sql`(case when ${featureOn("cycles", context)} then coalesce((
          select ${groupMembership.cycleId}
          from ${cycleTaskTable} as ${sql.identifier("group_cycle_task")}
          inner join ${cycleTable} as ${sql.identifier("group_cycle")}
            on ${groupCycle.id} = ${groupMembership.cycleId}
            and ${groupCycle.projectId} = ${taskTable.projectId}
          where ${groupMembership.taskId} = ${taskTable.id}
        ), ${NONE_GROUP}::text) else ${NONE_GROUP}::text end)`,
      };
    case "assignee":
      return { many: true, sql: assigneesOfTaskSql };
    case "label":
      return {
        many: true,
        sql: sql`coalesce((
          select array_agg(distinct ${sql.raw(`'${LABEL_NAME_PREFIX}'`)} || ${groupLabel.name})
          from ${labelTable} as ${sql.identifier("group_label")}
          where ${groupLabel.taskId} = ${taskTable.id}
        ), ${EMPTY_KEYS})`,
      };
    case "module":
      return {
        many: true,
        sql: sql`(case when ${featureOn("modules", context)} then coalesce((
          select array_agg(${groupLink.moduleId})
          from ${moduleTaskTable} as ${sql.identifier("group_module_task")}
          inner join ${moduleTable} as ${sql.identifier("group_module")}
            on ${groupModule.id} = ${groupLink.moduleId}
            and ${groupModule.projectId} = ${taskTable.projectId}
            and ${groupModule.archivedAt} is null
          where ${groupLink.taskId} = ${taskTable.id}
        ), ${EMPTY_KEYS}) else ${EMPTY_KEYS} end)`,
      };
  }
}

// --- group order -----------------------------------------------------------

export type CycleGroupMeta = {
  id: string;
  projectId: string;
  name: string;
  status: CycleStatus;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  createdAt: Date;
};

export type ModuleGroupMeta = {
  id: string;
  projectId: string;
  name: string;
  status: ModuleStatus;
};

export type PointGroupMeta = {
  id: string;
  projectId: string;
  position: number;
};

/** What ordering needs to know about group keys. */
export type GroupLookup = {
  context: QueryContext;
  users: ReadonlyMap<string, { name: string }>;
  cycles: ReadonlyMap<string, CycleGroupMeta>;
  modules: ReadonlyMap<string, ModuleGroupMeta>;
  points: ReadonlyMap<string, PointGroupMeta>;
};

const PRIORITY_ORDER: readonly string[] = [...VALID_PRIORITIES].reverse();

const CYCLE_STATUS_RANK: Record<CycleStatus, number> = {
  current: 0,
  upcoming: 1,
  draft: 2,
  completed: 3,
};

type SortTuple = (number | string)[];

function lower(value: string): string {
  return value.toLocaleLowerCase();
}

function dayNumber(day: string | null): number {
  return day ? Date.parse(`${day}T00:00:00.000Z`) : 0;
}

function cycleTuple(cycle: CycleGroupMeta): SortTuple {
  const rank = CYCLE_STATUS_RANK[cycle.status];
  switch (cycle.status) {
    case "current":
    case "upcoming":
      return [0, rank, dayNumber(cycle.startDate), cycle.id];
    case "draft":
      return [0, rank, cycle.sortOrder, -cycle.createdAt.getTime(), cycle.id];
    case "completed":
      return [0, rank, -dayNumber(cycle.endDate), cycle.id];
  }
}

/**
 * Dropdowns by option order (a removed option still on tasks after the rest),
 * numbers by value, everything else by text. Dates are stored as YYYY-MM-DD,
 * so their text order is their date order.
 */
function customFieldTuple(
  fieldId: string,
  key: string,
  lookup: GroupLookup,
): SortTuple {
  const value = key.startsWith(CUSTOM_FIELD_VALUE_PREFIX)
    ? key.slice(CUSTOM_FIELD_VALUE_PREFIX.length)
    : key;
  const field = lookup.context.displayFields?.get(fieldId);
  if (field?.type === "dropdown") {
    const index = field.options.indexOf(value);
    return index < 0 ? [1, lower(value), value] : [0, index, value];
  }
  if (field?.type === "number") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? [1, value] : [0, parsed, value];
  }
  return [0, lower(value), value];
}

/** Sort position of one group key: `none` last, unknown keys before it. */
function sortTuple(
  key: GroupByKey,
  value: string,
  lookup: GroupLookup,
): SortTuple {
  if (value === NONE_GROUP && key !== "status") return [2];
  if (isCustomFieldDisplayKey(key)) {
    return customFieldTuple(customFieldIdOfKey(key), value, lookup);
  }
  switch (key) {
    case "status": {
      if (value === PLANNED_STATUS) return [0, -1, ""];
      const column = lookup.context.projects[0]?.columns.find(
        (candidate) => candidate.slug === value,
      );
      return column ? [0, column.position, value] : [1, 0, value];
    }
    case "group":
      return [0, COLUMN_GROUP_RANK[value as ColumnGroup] ?? 99, value];
    case "priority": {
      const index = PRIORITY_ORDER.indexOf(value);
      return [0, index < 0 ? 99 : index, value];
    }
    case "assignee":
    case "createdBy": {
      const user = lookup.users.get(value);
      return user ? [0, lower(user.name), user.name, value] : [1, value];
    }
    case "label": {
      const name = value.slice(LABEL_NAME_PREFIX.length);
      return [0, lower(name), name];
    }
    case "cycle": {
      const cycle = lookup.cycles.get(value);
      return cycle ? cycleTuple(cycle) : [1, value];
    }
    case "module": {
      const found = lookup.modules.get(value);
      return found
        ? [0, MODULE_STATUSES.indexOf(found.status), lower(found.name), value]
        : [1, value];
    }
    case "estimate": {
      const point = lookup.points.get(value);
      if (!point) return [1, value];
      const projectIndex = lookup.context.projects.findIndex(
        (project) => project.id === point.projectId,
      );
      return [0, projectIndex, point.position, value];
    }
    case "project": {
      const index = lookup.context.projects.findIndex(
        (project) => project.id === value,
      );
      return [0, index < 0 ? Number.MAX_SAFE_INTEGER : index, value];
    }
  }
}

function compareTuples(a: SortTuple, b: SortTuple): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return String(left) < String(right) ? -1 : 1;
  }
  return 0;
}

/** Group keys in display order for the key (B4 §3.4). */
export function sortGroupKeys(
  key: GroupByKey,
  values: readonly string[],
  lookup: GroupLookup,
): string[] {
  return values
    .map((value) => ({ value, tuple: sortTuple(key, value, lookup) }))
    .sort((a, b) => compareTuples(a.tuple, b.tuple))
    .map((entry) => entry.value);
}
