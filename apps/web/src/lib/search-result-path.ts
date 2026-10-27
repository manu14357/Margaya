import { cyclePath } from "@/lib/cycle/entity-link";
import { intakeItemPath, isIntakeStatus } from "@/lib/intake";
import { modulePath } from "@/lib/module/entity-link";
import { viewPath } from "@/lib/view/entity-link";

/** The planning kinds global search returns besides tasks and pages. */
export const PLANNING_RESULT_TYPES = [
  "cycle",
  "module",
  "view",
  "intake",
] as const;

export type PlanningResultType = (typeof PLANNING_RESULT_TYPES)[number];

type PlanningResult = {
  id: string;
  type: string;
  projectId?: string;
  status?: string;
};

/**
 * Where a cycle, module, saved view or intake result opens, or null for any
 * other kind (and for a project-scoped kind that came without a project).
 */
export function planningResultPath(
  result: PlanningResult,
  workspaceId: string,
): string | null {
  const { projectId } = result;
  switch (result.type) {
    case "cycle":
      return projectId ? cyclePath(workspaceId, projectId, result.id) : null;
    case "module":
      return projectId ? modulePath(workspaceId, projectId, result.id) : null;
    case "view":
      return viewPath(workspaceId, result.id, projectId);
    case "intake":
      return projectId
        ? intakeItemPath({
            workspaceId,
            projectId,
            itemId: result.id,
            status:
              result.status && isIntakeStatus(result.status)
                ? result.status
                : undefined,
          })
        : null;
    default:
      return null;
  }
}
