import { inArray, sql } from "drizzle-orm";
import { taskTable } from "../../database/schema";
import type { SetFilterKey } from "./registry";

export const projectKey: SetFilterKey = {
  key: "project",
  kind: "set",
  matchAny: (values) => inArray(taskTable.projectId, [...values]),
  isEmpty: () => sql`false`,
};
