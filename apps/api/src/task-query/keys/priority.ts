import { inArray, sql } from "drizzle-orm";
import { taskTable } from "../../database/schema";
import { VALID_PRIORITIES } from "../../task/validate-task-fields";
import type { SetFilterKey } from "./registry";

export const priorityKey: SetFilterKey = {
  key: "priority",
  kind: "set",
  values: VALID_PRIORITIES,
  matchAny: (values) => inArray(taskTable.priority, [...values]),
  isEmpty: () => sql`false`,
};
