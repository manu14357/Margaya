import { inArray, sql } from "drizzle-orm";
import { CREATABLE_COLUMN_GROUPS } from "../../column/groups";
import { taskGroupSql } from "../../task/scope";
import type { SetFilterKey } from "./registry";

/** B1's task group; planned tasks are backlog. Triage is never in scope. */
export const groupKey: SetFilterKey = {
  key: "group",
  kind: "set",
  values: CREATABLE_COLUMN_GROUPS,
  matchAny: (values) => inArray(taskGroupSql, [...values]),
  isEmpty: () => sql`false`,
};
