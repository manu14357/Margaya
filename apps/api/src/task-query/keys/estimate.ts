import { inArray, sql } from "drizzle-orm";
import { taskTable } from "../../database/schema";
import { featureOn } from "../context";
import type { SetFilterKey } from "./registry";

// A task's estimate is always a point of its project's active system (B6's
// invariant), so the column alone decides; the feature flag hides it (K6).
export const estimateKey: SetFilterKey = {
  key: "estimate",
  kind: "set",
  matchAny: (values, context) =>
    sql`(${featureOn("estimates", context)} and ${taskTable.estimatePointId} is not null and ${inArray(taskTable.estimatePointId, [...values])})`,
  isEmpty: (context) =>
    sql`(not ${featureOn("estimates", context)} or ${taskTable.estimatePointId} is null)`,
};
