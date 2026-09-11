import { sql } from "drizzle-orm";
import db from "../../database";
import { moduleTaskTable } from "../../database/schema";
import { getScopeEstimates } from "../../estimate/totals";
import { reportFromScope } from "../../task/progress-queries";
import { workspaceToday } from "../../utils/timezone";
import { moduleScopeTaskLabels, moduleScopeTasks } from "../queries";
import { requireModule } from "./shared";

/** Modules often span long periods; longer ranges get no chart. */
export const MAX_MODULE_CHART_DAYS = 731;

/**
 * Counts, the burn-down/burn-up chart (also in points mode), breakdowns and
 * estimate totals over the module's visible tasks. The reads share one
 * snapshot, so they always agree.
 */
async function getModuleProgress(moduleId: string, workspaceId: string) {
  return db.transaction(
    async (tx) => {
      const found = await requireModule(tx, moduleId);
      const today = await workspaceToday(workspaceId, tx);
      const { estimates, estimateValues } = await getScopeEstimates(
        tx,
        found.projectId,
        {
          kind: "subquery",
          sql: sql`select ${moduleTaskTable.taskId} from ${moduleTaskTable} where ${moduleTaskTable.moduleId} = ${moduleId}`,
        },
      );
      const report = await reportFromScope(tx, {
        workspaceId,
        tasks: await moduleScopeTasks(tx, moduleId),
        labels: await moduleScopeTaskLabels(tx, moduleId),
        startDate: found.startDate,
        endDate: found.targetDate,
        today,
        maxChartDays: MAX_MODULE_CHART_DAYS,
        estimates,
        estimateValues,
      });
      return { moduleId, today, ...report };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export default getModuleProgress;
