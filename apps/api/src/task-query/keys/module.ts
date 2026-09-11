import { inArray, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { moduleTable, moduleTaskTable, taskTable } from "../../database/schema";
import { featureOn } from "../context";
import type { SetFilterKey } from "./registry";

const LINK_ALIAS = "module_task_filter";
const MODULE_ALIAS = "module_filter";
const link = alias(moduleTaskTable, LINK_ALIAS);
const linkedModule = alias(moduleTable, MODULE_ALIAS);

/** A link to an active module of the task's own project (plus `condition`). */
function activeLinkExists(condition?: SQL): SQL {
  return sql`exists (
    select 1 from ${moduleTaskTable} as ${sql.identifier(LINK_ALIAS)}
    inner join ${moduleTable} as ${sql.identifier(MODULE_ALIAS)}
      on ${linkedModule.id} = ${link.moduleId}
      and ${linkedModule.projectId} = ${taskTable.projectId}
      and ${linkedModule.archivedAt} is null
    where ${link.taskId} = ${taskTable.id}${condition ? sql` and (${condition})` : sql``}
  )`;
}

export const moduleKey: SetFilterKey = {
  key: "module",
  kind: "set",
  matchAny: (values, context) =>
    sql`(${featureOn("modules", context)} and ${activeLinkExists(inArray(link.moduleId, [...values]))})`,
  isEmpty: (context) =>
    sql`(not ${featureOn("modules", context)} or not ${activeLinkExists()})`,
};
