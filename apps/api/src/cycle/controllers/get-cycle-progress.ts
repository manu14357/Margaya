import { eq } from "drizzle-orm";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { disabledEstimateTotals } from "../../estimate/totals";
import { projectToday } from "../../utils/timezone";
import type { Reader } from "../queries";
import { computeLiveReport, requireCycle } from "./shared";

async function estimatesEnabled(reader: Reader, projectId: string) {
  const [project] = await reader
    .select({ enabled: projectTable.estimatesEnabled })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return project?.enabled ?? false;
}

/**
 * The cycle's progress report: live over its current scope, or the report
 * frozen by its first transfer. The reads share one snapshot, so counts,
 * chart and breakdowns always agree.
 */
async function getCycleProgress(cycleId: string, workspaceId: string) {
  return db.transaction(
    async (tx) => {
      const cycle = await requireCycle(tx, cycleId);
      const today = await projectToday(cycle.projectId, tx);

      if (cycle.progressSnapshot) {
        const { frozenAt, estimates, estimateChart, ...report } =
          cycle.progressSnapshot;
        // Frozen estimates follow the feature like live ones: hidden while
        // it is off, back when it is on. Reports frozen before estimates
        // existed have none.
        const showEstimates = await estimatesEnabled(tx, cycle.projectId);
        return {
          cycleId,
          isFrozen: true,
          frozenAt: new Date(frozenAt),
          today,
          ...report,
          estimates: showEstimates
            ? (estimates ?? null)
            : disabledEstimateTotals(),
          estimateChart: showEstimates ? (estimateChart ?? null) : null,
        };
      }

      const report = await computeLiveReport(tx, cycle, workspaceId, today);
      return {
        cycleId,
        isFrozen: false,
        frozenAt: null,
        today,
        ...report,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export default getCycleProgress;
