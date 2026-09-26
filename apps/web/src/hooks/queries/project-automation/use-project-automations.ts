import { useQuery } from "@tanstack/react-query";
import getProjectAutomations from "@/fetchers/project-automation/get-project-automations";
import { projectAutomationQueryKeys } from "./project-automation-query-keys";

export function useProjectAutomations(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: projectAutomationQueryKeys.automations(workspaceId, projectId),
    queryFn: () => getProjectAutomations(projectId),
    enabled: Boolean(workspaceId && projectId),
  });
}

export default useProjectAutomations;
