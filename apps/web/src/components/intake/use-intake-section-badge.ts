import { useGetIntakeSummary } from "@/hooks/queries/intake/use-get-intake-summary";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/**
 * The Intake tab's pending count, for triagers only. Null while the caller
 * can't triage, the feature is off or nothing is waiting.
 */
export function useIntakeSectionBadge({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}): number | null {
  const { canTriageIntake, canReadIntake, isCheckingPermissions } =
    useWorkspacePermission();
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const enabled =
    !isCheckingPermissions &&
    canTriageIntake() &&
    canReadIntake() &&
    isEnabled("intake");
  const { data } = useGetIntakeSummary(projectId, { enabled });
  if (!enabled || !data?.pending) return null;
  return data.pending;
}

export default useIntakeSectionBadge;
