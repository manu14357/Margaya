import { HTTPException } from "hono/http-exception";
import setTaskCycle from "../cycle/controllers/set-task-cycle";
import type db from "../database";
import { assertTaskEstimatePoint } from "../estimate/assert-task-estimate";
import { shareProjectEstimates } from "../estimate/write";
import { setTaskModules } from "../module/controllers/task-modules";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TargetFeatures = {
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  estimatesEnabled: boolean;
};

/**
 * Whether the copy can keep the source's estimate: the feature is on and
 * the point belongs to the project's active system. Runs inside the copy's
 * transaction under the shared estimate lock, like task create (B6).
 */
export async function canKeepEstimate(
  tx: Transaction,
  projectId: string,
  pointId: string,
  features: TargetFeatures,
): Promise<boolean> {
  if (!features.estimatesEnabled) return false;
  await shareProjectEstimates(tx, projectId);
  try {
    await assertTaskEstimatePoint(projectId, pointId, tx);
    return true;
  } catch {
    return false;
  }
}

/**
 * After the copy committed: puts it in the source's cycle (B2 helper; not a
 * completed or archived one) and active modules (B3 helper). Each runs on its
 * own; a failure is logged and reported, and the copy itself stands.
 */
export async function applyCopyPlanning({
  taskId,
  cycleId,
  moduleIds,
  features,
  workspaceId,
  userId,
}: {
  taskId: string;
  cycleId: string | null;
  moduleIds: readonly string[];
  features: TargetFeatures;
  workspaceId: string;
  userId: string;
}): Promise<{ applied: boolean; failed: boolean }> {
  let applied = false;
  let failed = false;

  if (cycleId) {
    if (!features.cyclesEnabled) {
      failed = true;
    } else {
      try {
        await setTaskCycle({ taskId, cycleId, workspaceId, userId });
        applied = true;
      } catch (error) {
        failed = true;
        if (!(error instanceof HTTPException)) {
          console.error("Copy: the cycle was not copied", error);
        }
      }
    }
  }

  if (moduleIds.length > 0) {
    if (!features.modulesEnabled) {
      failed = true;
    } else {
      try {
        await setTaskModules({ taskId, userId, addModuleIds: [...moduleIds] });
        applied = true;
      } catch (error) {
        failed = true;
        if (!(error instanceof HTTPException)) {
          console.error("Copy: the modules were not copied", error);
        }
      }
    }
  }

  return { applied, failed };
}
