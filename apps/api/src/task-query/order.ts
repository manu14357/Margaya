import { type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  columnTable,
  cycleTable,
  cycleTaskTable,
  estimatePointTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  projectTable,
  taskRelationTable,
  taskTable,
} from "../database/schema";
import { voteScoreSql, voteUpsSql } from "../publication/votes";
import { smallestAssigneeNameSql } from "../task/assignees";
import { taskGroupSql, visibleTaskConditionOf } from "../task/scope";
import { featureOn, type QueryContext } from "./context";
import type { OrderByField, OrderDirection } from "./schema";

// Order-by allow-list (B4 §2.7). Nulls go last in both directions; ties
// break by createdAt descending, then id, so paging is deterministic. Keys
// that need other tables are correlated scalar subqueries, computed only
// when that order is asked for.

export type ResolvedOrder = { field: OrderByField; direction: OrderDirection };

export const DEFAULT_DIRECTIONS: Record<OrderByField, OrderDirection> = {
  manual: "asc",
  createdAt: "desc",
  updatedAt: "desc",
  completedAt: "desc",
  startDate: "asc",
  dueDate: "asc",
  priority: "desc",
  title: "asc",
  number: "asc",
  status: "asc",
  assignee: "asc",
  label: "asc",
  cycle: "asc",
  module: "asc",
  estimate: "desc",
  subTaskCount: "desc",
  archivedAt: "desc",
  voteScore: "desc",
};

/** Legacy board sort values (the web's sort-tasks) to engine fields. */
export function orderFieldFromLegacySort(sortBy: string): OrderByField | null {
  if (sortBy === "position") return "manual";
  const fields: readonly string[] = [
    "createdAt",
    "priority",
    "dueDate",
    "title",
    "number",
    "estimate",
  ];
  return fields.includes(sortBy) ? (sortBy as OrderByField) : null;
}

/** The request's order, or the scope default (manual with listed projects). */
export function resolveOrder(
  orderBy: { field: OrderByField; direction?: OrderDirection } | undefined,
  hasProjectScope: boolean,
): ResolvedOrder {
  const field = orderBy?.field ?? (hasProjectScope ? "manual" : "createdAt");
  return { field, direction: orderBy?.direction ?? DEFAULT_DIRECTIONS[field] };
}

const priorityRankSql = sql`(case ${taskTable.priority}
  when 'urgent' then 4 when 'high' then 3 when 'medium' then 2
  when 'low' then 1 else 0 end)`;

const groupRankSql = sql`(case ${taskGroupSql}
  when 'backlog' then 0 when 'unstarted' then 1 when 'started' then 2
  when 'completed' then 3 when 'cancelled' then 4 else 5 end)`;

const orderProject = alias(projectTable, "order_project");
const orderLabel = alias(labelTable, "order_label");
const orderMembership = alias(cycleTaskTable, "order_cycle_task");
const orderCycle = alias(cycleTable, "order_cycle");
const orderLink = alias(moduleTaskTable, "order_module_task");
const orderModule = alias(moduleTable, "order_module");
const orderPoint = alias(estimatePointTable, "order_point");
const orderRelation = alias(taskRelationTable, "order_relation");
const subTask = alias(taskTable, "order_sub_task");

/** Visible sub-tasks of the outer task (for ordering and hydration). */
export const subTaskCountSql = sql<number>`(
  select count(*)::int
  from ${taskRelationTable} as ${sql.identifier("order_relation")}
  inner join ${taskTable} as ${sql.identifier("order_sub_task")}
    on ${subTask.id} = ${orderRelation.targetTaskId}
  where ${orderRelation.sourceTaskId} = ${taskTable.id}
    and ${orderRelation.relationType} = 'subtask'
    and ${visibleTaskConditionOf(subTask)}
)`;

function keyExpressions(field: OrderByField, context: QueryContext): SQL[] {
  switch (field) {
    case "manual":
      return [sql`${taskTable.position}`, sql`${taskTable.number}`];
    case "createdAt":
      return [sql`${taskTable.createdAt}`];
    case "updatedAt":
      return [sql`${taskTable.updatedAt}`];
    case "completedAt":
      return [sql`${taskTable.completedAt}`];
    case "startDate":
      return [sql`${taskTable.startDate}`];
    case "dueDate":
      return [sql`${taskTable.dueDate}`];
    case "priority":
      return [priorityRankSql];
    case "title":
      return [sql`lower(${taskTable.title})`];
    case "number":
      return context.projectIds.length === 1
        ? [sql`${taskTable.number}`]
        : [
            sql`(select lower(${orderProject.slug}) from ${projectTable} as ${sql.identifier("order_project")} where ${orderProject.id} = ${taskTable.projectId})`,
            sql`${taskTable.number}`,
          ];
    case "status":
      // Planned tasks lead their (backlog) group; across projects columns
      // compare by name.
      return context.projectIds.length === 1
        ? [groupRankSql, sql`coalesce(${columnTable.position}, -1)`]
        : [groupRankSql, sql`coalesce(lower(${columnTable.name}), '')`];
    case "assignee":
      return [smallestAssigneeNameSql];
    case "label":
      return [
        sql`(select min(lower(${orderLabel.name})) from ${labelTable} as ${sql.identifier("order_label")} where ${orderLabel.taskId} = ${taskTable.id})`,
      ];
    case "cycle":
      return [
        sql`(case when ${featureOn("cycles", context)} then (
          select lower(${orderCycle.name})
          from ${cycleTaskTable} as ${sql.identifier("order_cycle_task")}
          inner join ${cycleTable} as ${sql.identifier("order_cycle")}
            on ${orderCycle.id} = ${orderMembership.cycleId}
            and ${orderCycle.projectId} = ${taskTable.projectId}
          where ${orderMembership.taskId} = ${taskTable.id}
        ) end)`,
      ];
    case "module":
      return [
        sql`(case when ${featureOn("modules", context)} then (
          select min(lower(${orderModule.name}))
          from ${moduleTaskTable} as ${sql.identifier("order_module_task")}
          inner join ${moduleTable} as ${sql.identifier("order_module")}
            on ${orderModule.id} = ${orderLink.moduleId}
            and ${orderModule.projectId} = ${taskTable.projectId}
            and ${orderModule.archivedAt} is null
          where ${orderLink.taskId} = ${taskTable.id}
        ) end)`,
      ];
    case "estimate":
      return [
        sql`(case when ${featureOn("estimates", context)} then (
          select ${orderPoint.position}
          from ${estimatePointTable} as ${sql.identifier("order_point")}
          where ${orderPoint.id} = ${taskTable.estimatePointId}
        ) end)`,
      ];
    case "subTaskCount":
      return [subTaskCountSql];
    case "archivedAt":
      return [sql`${taskTable.archivedAt}`];
    case "voteScore":
      return [voteScoreSql, voteUpsSql];
  }
}

/** ORDER BY items for the order plus the deterministic tie-breakers. */
export function orderByItems(order: ResolvedOrder, context: QueryContext): SQL {
  const direction = order.direction === "desc" ? sql`desc` : sql`asc`;
  const items = keyExpressions(order.field, context).map(
    (expression) => sql`${expression} ${direction} nulls last`,
  );
  items.push(sql`${taskTable.createdAt} desc`, sql`${taskTable.id} asc`);
  return sql.join(items, sql`, `);
}
