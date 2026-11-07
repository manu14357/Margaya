import { type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  columnTable,
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import { taskGroupSql } from "../../task/scope";
import { textArray } from "../context";
import type { SetFilterKey } from "./registry";

// Blocked is read from the relations, not stored: an open task that another
// open task of the workspace, outside the trash, still blocks. It never stops
// a status change. A blocker in a project the caller can't see still counts,
// unnamed, like the personal brief's hidden blockers, except for a guest, who
// hears nothing of projects they weren't added to. The key is refused on
// public boards.

const RELATION_ALIAS = "blocked_filter_relation";
const BLOCKER_ALIAS = "blocked_filter_blocker";
const BLOCKER_COLUMN_ALIAS = "blocked_filter_column";
const BLOCKER_PROJECT_ALIAS = "blocked_filter_blocker_project";
const TASK_PROJECT_ALIAS = "blocked_filter_task_project";
const relation = alias(taskRelationTable, RELATION_ALIAS);
const blocker = alias(taskTable, BLOCKER_ALIAS);
const blockerColumn = alias(columnTable, BLOCKER_COLUMN_ALIAS);
const blockerProject = alias(projectTable, BLOCKER_PROJECT_ALIAS);
const taskProject = alias(projectTable, TASK_PROJECT_ALIAS);

/**
 * Needs `column` LEFT JOINed through taskColumnJoin. Never NULL. Blockers in
 * `uncountedProjectIds` are as good as absent.
 */
export function isBlockedSql(
  uncountedProjectIds: readonly string[] = [],
): SQL<boolean> {
  return sql<boolean>`(
  ${taskGroupSql} not in ('completed', 'cancelled')
  and exists (
    select 1 from ${taskRelationTable} as ${sql.identifier(RELATION_ALIAS)}
    join ${taskTable} as ${sql.identifier(BLOCKER_ALIAS)}
      on ${blocker.id} = ${relation.sourceTaskId}
    join ${projectTable} as ${sql.identifier(BLOCKER_PROJECT_ALIAS)}
      on ${blockerProject.id} = ${blocker.projectId}
    join ${projectTable} as ${sql.identifier(TASK_PROJECT_ALIAS)}
      on ${taskProject.id} = ${taskTable.projectId}
    left join ${columnTable} as ${sql.identifier(BLOCKER_COLUMN_ALIAS)}
      on ${blockerColumn.projectId} = ${blocker.projectId}
      and ${blockerColumn.slug} = ${blocker.status}
    where ${relation.targetTaskId} = ${taskTable.id}
      and ${relation.relationType} = 'blocks'
      and ${blocker.deletedAt} is null
      and ${blocker.archivedAt} is null
      and ${blocker.completedAt} is null
      and ${blockerProject.deletedAt} is null
      and ${blockerProject.workspaceId} = ${taskProject.workspaceId}
      and coalesce(${blockerColumn.group}, '') not in ('completed', 'cancelled')
      ${
        uncountedProjectIds.length > 0
          ? sql`and ${blocker.projectId} <> all(${textArray(uncountedProjectIds)})`
          : sql.empty()
      }
  )
)`;
}

export const blockedKey: SetFilterKey = {
  key: "blocked",
  kind: "set",
  values: ["true", "false"],
  personal: true,
  matchAny: (values, context) => {
    const blocked = values.includes("true");
    const clear = values.includes("false");
    if (blocked && clear) return sql`true`;
    const isBlocked = isBlockedSql(context.guestHiddenProjectIds);
    return clear ? sql`not ${isBlocked}` : isBlocked;
  },
  // Every task either is blocked or isn't, so `none` matches nothing.
  isEmpty: () => sql`false`,
};
