import { inArray, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { taskRelationTable, taskTable } from "../../database/schema";
import type { SetFilterKey } from "./registry";

// A task's parent is the source of a `subtask` relation that targets it (K17).

const RELATION_ALIAS = "parent_relation_filter";
const relation = alias(taskRelationTable, RELATION_ALIAS);
// A trashed parent reads as none (C7).
const PARENT_TASK_ALIAS = "parent_relation_task";

function parentRelationExists(condition?: SQL): SQL {
  return sql`exists (
    select 1 from ${taskRelationTable} as ${sql.identifier(RELATION_ALIAS)}
    where ${relation.targetTaskId} = ${taskTable.id}
      and ${relation.relationType} = 'subtask'
      and not exists (
        select 1 from ${taskTable} as ${sql.identifier(PARENT_TASK_ALIAS)}
        where ${sql.identifier(PARENT_TASK_ALIAS)}.${sql.identifier("id")} = ${relation.sourceTaskId}
          and ${sql.identifier(PARENT_TASK_ALIAS)}.${sql.identifier("deleted_at")} is not null
      )${condition ? sql` and (${condition})` : sql``}
  )`;
}

/** Top-level tasks only (display.showSubTasks false). */
export const hasNoParentSql = sql`not ${parentRelationExists()}`;

export const parentKey: SetFilterKey = {
  key: "parent",
  kind: "set",
  matchAny: (values) =>
    parentRelationExists(inArray(relation.sourceTaskId, [...values])),
  isEmpty: () => hasNoParentSql,
};
