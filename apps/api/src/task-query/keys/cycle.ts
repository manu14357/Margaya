import { and, gte, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cycleTable, cycleTaskTable, taskTable } from "../../database/schema";
import { featureOn } from "../context";
import type { SetFilterKey } from "./registry";

/** The token for "the current cycle of the task's own project" (UTC, D2). */
export const CURRENT_CYCLE = "current";

const MEMBERSHIP_ALIAS = "cycle_task_filter";
const CYCLE_ALIAS = "cycle_filter";
const membership = alias(cycleTaskTable, MEMBERSHIP_ALIAS);
const cycle = alias(cycleTable, CYCLE_ALIAS);

/** A membership in a cycle of the task's own project (plus `condition`). */
function membershipExists(condition?: SQL): SQL {
  return sql`exists (
    select 1 from ${cycleTaskTable} as ${sql.identifier(MEMBERSHIP_ALIAS)}
    inner join ${cycleTable} as ${sql.identifier(CYCLE_ALIAS)}
      on ${cycle.id} = ${membership.cycleId}
      and ${cycle.projectId} = ${taskTable.projectId}
    where ${membership.taskId} = ${taskTable.id}${condition ? sql` and (${condition})` : sql``}
  )`;
}

export const cycleKey: SetFilterKey = {
  key: "cycle",
  kind: "set",
  tokens: [CURRENT_CYCLE],
  matchAny(values, context) {
    const ids = values.filter((value) => value !== CURRENT_CYCLE);
    const matches: SQL[] = [];
    if (ids.length > 0) matches.push(inArray(membership.cycleId, ids));
    if (values.includes(CURRENT_CYCLE)) {
      matches.push(
        and(
          lte(cycle.startDate, context.utcToday),
          gte(cycle.endDate, context.utcToday),
          isNull(cycle.archivedAt),
        ) as SQL,
      );
    }
    return sql`(${featureOn("cycles", context)} and ${membershipExists(or(...matches))})`;
  },
  isEmpty: (context) =>
    sql`(not ${featureOn("cycles", context)} or not ${membershipExists()})`,
};
