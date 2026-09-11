import { inArray, sql } from "drizzle-orm";
import { taskTable } from "../../database/schema";
import type { SetFilterKey } from "./registry";

/** The column slug (or `planned`), matched per project by slug. */
export const statusKey: SetFilterKey = {
  key: "status",
  kind: "set",
  matchAny: (values) => inArray(taskTable.status, [...values]),
  isEmpty: () => sql`false`,
};
